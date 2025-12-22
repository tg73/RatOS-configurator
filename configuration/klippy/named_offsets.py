# Named Offsets
#
# Manages multiple named offsets with semantics similar to SET_GCODE_OFFSET. Allows
# setting, clearing, and querying of named offsets, each of which can have X, Y, Z, and E
# components. The combined offset is applied to all movements via the gcode_move transform.
#
# This allows for compartmentalised management of offsets for different purposes, such as IDEX toolhead
# adjustments and thermal expansion compensation - while leaving the primary offset controlled
# by SET_GCODE_OFFSET free for user adjustments.
#
# SAVE_GCODE_STATE and RESTORE_GCODE_STATE are overridden to include the named offsets in
# the saved/restored state.
#
# NOTE: At present, all offsets are zeroed when the stepper motors are turned off.
#
# Copyright (C) 2025 Tom Glastonbury <t@tg73.net>
#
# This file may be distributed under the terms of the GNU GPLv3 license.

from functools import reduce
from typing import Dict, Tuple, Final
from math import isclose

COMBINED_OFFSET_KEY: Final = 'combined_offset'
OFFSET_NAMES: Final = ('toolhead', 'true_zero_correction', 'hotend_thermal_expansion')
ZERO_OFFSET: Final = (0., 0., 0., 0.)
XYZE: Final = 'XYZE'

# TODO: consider:
#   allow valid offset names to be specificed in config (we restrict to valid to avoid accidental typos in use)
#     name_toolhead: "description of toolhead"
#     toolhead_reset_on_motor_off: True
#     toolhead_default_value: 0.0
#     toolhead_include_in_save_state: True

class NamedOffsetManager:
	# Items are name: (X,Y,Z,E)
	offsets: Dict[str, Tuple[float, float, float, float]]
	combined_offset: Tuple[float, float, float, float]

	def __init__(self, config):
		self.printer = config.get_printer()
		self.name = config.get_name()
		self.printer.register_event_handler("klippy:connect",
											self._handle_connect)

		# All offsets are reset when the stepper motors are turned off
		# TODO: review, should this be conditional/configurarable per-offset?
		# TODO: need to take care wrt state after printing if motors are not turned off before starting a new print
		#       (not a concern for code here, probably, but worth noting)

		self.printer.register_event_handler("stepper_enable:motor_off",
											self._handle_motor_off)

		self.gcode_move = None
		self.next_transform = None
		self.offsets = {}
		self.status = None
		self.combined_offset = ZERO_OFFSET
		self._original_save_gcode_state_cmd = None
		self._original_restore_gcode_state_cmd = None
		self._original_get_position_cmd = None
		self.saved_states = {}

		self.gcode = self.printer.lookup_object('gcode')

		self.gcode.register_command('GET_NAMED_OFFSETS', self.cmd_GET_NAMED_OFFSETS,
							   desc=self.desc_GET_NAMED_OFFSETS)
		self.gcode.register_command('SET_NAMED_OFFSET', self.cmd_SET_NAMED_OFFSET,
							   desc=self.desc_SET_NAMED_OFFSET)
		self.gcode.register_command('CLEAR_NAMED_OFFSET', self.cmd_CLEAR_NAMED_OFFSET,
							   desc=self.desc_CLEAR_NAMED_OFFSET)

	def _handle_connect(self):
		self._original_save_gcode_state_cmd = self._override_command('SAVE_GCODE_STATE', self.cmd_SAVE_GCODE_STATE)
		self._original_restore_gcode_state_cmd = self._override_command('RESTORE_GCODE_STATE', self.cmd_RESTORE_GCODE_STATE)
		self._original_get_position_cmd = self._override_command('GET_POSITION', self.cmd_GET_POSITION, when_not_ready=True)
		self.gcode_move = self.printer.lookup_object('gcode_move')
		self.next_transform = self.gcode_move.set_move_transform(self, force=True)

	def _handle_motor_off(self, print_time):
		self._reset()

	def _reset(self):
		self.offsets = {}
		self.combined_offset = ZERO_OFFSET
		self._update_status()

	def _override_command(self, cmd_name, new_cmd, *, when_not_ready:bool=False):
		help_text = self.gcode.get_command_help().get(cmd_name, None)
		is_base_handler = self.gcode.base_gcode_handlers.get(cmd_name, None) is not None
		
		if is_base_handler != when_not_ready:
			raise self.printer.config_error(f"{cmd_name} is {'' if is_base_handler else 'not '}a base (aka 'when-not-ready') gcode handler, this is not expected. {self.name} cannot be enabled.")
		
		original_cmd = self.gcode.get_command(cmd_name, None)
		
		if original_cmd is None:
			raise self.printer.config_error(f"{cmd_name} command is not registered, {self.name} cannot be enabled.")

		self.gcode.register_command(cmd_name, new_cmd, when_not_ready=when_not_ready, desc=help_text)
		return original_cmd

	######
	# commands
	######
	def cmd_GET_POSITION(self, gcmd):
		self._original_get_position_cmd(gcmd)
		msg = "\n".join( f"{self.name}: {k}: {' '.join(f'{XYZE[i]}:{p:.6f}' for i, p in enumerate(v))}" for k, v in self.offsets.items())
		if msg:
			msg += f"\n{self.name}: {COMBINED_OFFSET_KEY}: {' '.join(f'{XYZE[i]}:{p:.6f}' for i, p in enumerate(self.combined_offset))}"
		else:
			msg = f"{self.name}: no named offsets defined"
		gcmd.respond_info(msg)

	def cmd_SAVE_GCODE_STATE(self, gcmd):
		self._original_save_gcode_state_cmd(gcmd)
		state_name = gcmd.get('NAME', 'default')
		self.saved_states[state_name] = dict(self.offsets)

	def cmd_RESTORE_GCODE_STATE(self, gcmd):
		self._original_restore_gcode_state_cmd(gcmd)
		state_name = gcmd.get('NAME', 'default')
		saved_offsets = self.saved_states.get(state_name, None)
		if saved_offsets is None:
			raise gcmd.error(f"Unknown named offsets state '{state_name}'")
		self.offsets = dict(saved_offsets)
		move = gcmd.get_int('MOVE', 0) == 1
		speed = gcmd.get_float('MOVE_SPEED', None, above=0.)
		self._offset_changed(move, speed)

	desc_GET_NAMED_OFFSETS = "Report current named offsets"
	def cmd_GET_NAMED_OFFSETS(self, gcmd):
		msg = "\n".join( f"{k}: {' '.join(f'{XYZE[i]}:{p:.6f}' for i, p in enumerate(v))}" for k, v in self.offsets.items())
		if msg:
			msg += f"\n{COMBINED_OFFSET_KEY}: {' '.join(f'{XYZE[i]}:{p:.6f}' for i, p in enumerate(self.combined_offset))}"
		else:
			msg = f"No named offsets defined"
		gcmd.respond_info(msg)

	desc_SET_NAMED_OFFSET = "Set a named offset."
	def cmd_SET_NAMED_OFFSET(self, gcmd):
		name = gcmd.get('NAME').lower().strip()
		if name not in OFFSET_NAMES:
			raise self.gcode.error(f"Offset name '{name}' is not recognized.")
		offset = list(self.offsets.get(name, ZERO_OFFSET))
		for pos, axis in enumerate(XYZE):
			v = gcmd.get_float(axis, None)
			if v is None:
				v = gcmd.get_float(axis + '_ADJUST', None)
				if v is None:
					continue
				v += offset[pos]
			offset[pos] = v
		offset = tuple(offset)
		if self._offset_is_zero(offset):
			self.offsets.pop(name, None)
		else:
			self.offsets[name] = offset
		move = gcmd.get_int('MOVE', 0) == 1
		speed = gcmd.get_float('MOVE_SPEED', None, above=0.)
		self._offset_changed(move, speed)

	desc_CLEAR_NAMED_OFFSET = "Clear a named offset. This is equivalent to setting all components of the offset to zero."
	def cmd_CLEAR_NAMED_OFFSET(self, gcmd):
		names = gcmd.get('NAME').lower().strip()
		move = gcmd.get_int('MOVE', 0) == 1
		speed = gcmd.get_float('MOVE_SPEED', None, above=0.)
		if names == 'all':
			self.offsets = {}
		else:
			names = [n.lower().strip() for n in names.split(',')]
			if any(n not in OFFSET_NAMES for n in names):
				msg = f"One or more offset names are not recognized: {', '.join(n for n in names if n not in OFFSET_NAMES)}"
				raise gcmd.error(msg)
			for n in names:
				self.offsets.pop(n, None)
		self._offset_changed(move, speed)

	def _offset_changed(self, move=False, move_speed=None):
		# MOVE and MOVE_SPEED behave like SET_GCODE_OFFSET

		previous_offset = self.combined_offset
		new_combined_offset = [0.] * 4
		for offset in self.offsets.values():
			for i in range(4):
				new_combined_offset[i] += offset[i]
		self.combined_offset = tuple(new_combined_offset)
		if self._offset_is_zero(self.combined_offset):
			# Clamp to exact zero to avoid floating point error accumulated during summation above.
			self.combined_offset = ZERO_OFFSET

		# If all offsets are cleared, it's possible that combined_offset remains ZERO_OFFSET despite
		# the set of individual offsets changing. So always update status. We don't expect this to lead
		# to many strictly unnecessary updates in practice.
		self._update_status()

		offset_delta = tuple(self.combined_offset[i] - previous_offset[i] for i in range(4))

		# NB: we don't use a close check here otherwise we might suppress
		# a sequence of tiny moves that add up to a significant change.
		if offset_delta == ZERO_OFFSET:
			# no change to any component of the combined offset, no need to update
			# position or move.
			return

		gcode_move = self.gcode_move
		gcode_move.reset_last_position()

		# Move the toolhead by the given offset if requested.
		# This mimics the behaviour and implementation of SET_GCODE_OFFSET in gcode_move.py
		if move:
			speed = gcode_move.speed if move_speed is None else move_speed
			for i in range(4):
				gcode_move.last_position[i] += offset_delta[i]
			gcode_move.move_with_transform(gcode_move.last_position, speed)

	# For use by other extensions
	def set_offset(self, name:str, *, x:float = None, y:float = None, z:float = None, e:float = None,
				x_adjust:float = None, y_adjust:float = None, z_adjust:float = None, e_adjust:float = None,
				 should_move:bool=False, move_speed:float=None):
		"""Set a named offset. Argument semantics follow that of SET_GCODE_OFFSET. If should_move is True, the toolhead will be moved by the offset."""
		if name:
			name = name.strip().lower()

		if name not in OFFSET_NAMES:
			raise self.gcode.error(f"Offset name '{name}' is not recognized.")

		offset = list(self.offsets.get(name, ZERO_OFFSET))

		for pos, (val, adjust) in enumerate(zip((x, y, z, e), (x_adjust, y_adjust, z_adjust, e_adjust))):
			if val is not None:
				offset[pos] = val
			elif adjust is not None:
				offset[pos] += adjust

		offset = tuple(offset)

		if self._offset_is_zero(offset):
			self.offsets.pop(name, None)
		else:
			self.offsets[name] = offset

		self._offset_changed(should_move, move_speed)

	######
	# gcode_move transform compliance
	######
	def get_position(self):
		# Remove correction
		offset = self.combined_offset
		pos = self.next_transform.get_position()[:]
		for i in range(4):
			pos[i] -= offset[i]
		return pos

	def move(self, newpos, speed):
		# Apply correction
		offset = self.combined_offset
		pos = newpos[:]
		for i in range(4):
			pos[i] += offset[i]
		self.next_transform.move(pos, speed)

	######
	# status
	######
	def _update_status(self):
		self.status = dict(self.offsets)
		self.status[COMBINED_OFFSET_KEY] = self.combined_offset

	def get_status(self, eventtime=None):
		if self.status is None:
			self._update_status()
		return self.status
	
	######
	# helpers
	######
	def _offset_is_zero(self, offset:Tuple[float, float, float, float]) -> bool:
		return all(isclose(v, 0.0, abs_tol=1e-9) for v in offset)


def load_config(config):
	return NamedOffsetManager(config)