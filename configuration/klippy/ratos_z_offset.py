# Additional Z-Offset Support
#
# Copyright (C) 2025 Tom Glastonbury <t@tg73.net>
#
# This file may be distributed under the terms of the GNU GPLv3 license.

COMBINED_OFFSET_KEY = 'combined_offset'
OFFSET_NAMES = ('toolhead', 'true_zero_correction', 'hotend_thermal_expansion')

class RatOSZOffset:
	def __init__(self, config):
		self.printer = config.get_printer()
		self.name = config.get_name()
		self.printer.register_event_handler("klippy:connect",
											self._handle_connect)

		# All offsets are reset when the stepper motors are turned off
		# or when a restart is requested

		self.printer.register_event_handler("stepper_enable:motor_off",
											self._handle_motor_off)
		self.printer.register_event_handler("gcode:request_restart",
                                            self._handle_request_restart)

		self.gcode_move = None
		self.next_transform = None
		self.offsets = {}
		self.status = None
		self.combined_offset = 0.

		self.gcode = self.printer.lookup_object('gcode')

		self.gcode.register_command('GET_RATOS_Z_OFFSET', self.cmd_GET_RATOS_Z_OFFSET,
							   desc=self.desc_GET_RATOS_Z_OFFSET)
		self.gcode.register_command('SET_RATOS_Z_OFFSET', self.cmd_SET_RATOS_Z_OFFSET,
							   desc=self.desc_SET_RATOS_Z_OFFSET)
		self.gcode.register_command('CLEAR_RATOS_Z_OFFSET', self.cmd_CLEAR_RATOS_Z_OFFSET,
							   desc=self.desc_CLEAR_RATOS_Z_OFFSET)

	def _handle_connect(self):
		self.gcode_move = self.printer.lookup_object('gcode_move')
		self.next_transform = self.gcode_move.set_move_transform(self, force=True)

	def _handle_motor_off(self, print_time):
		self._reset()

	def _handle_request_restart(self, print_time):
		self._reset()

	def _reset(self):
		self.offsets = {}
		self.combined_offset = 0.
		self._update_status()

	######
	# commands
	######
	desc_GET_RATOS_Z_OFFSET = "Report current RatOS Z offsets"
	def cmd_GET_RATOS_Z_OFFSET(self, gcmd):
		msg = "\n".join( f"{k}: {v:.5f}" for k, v in self.offsets.items())
		if msg:
			msg += f"\n{COMBINED_OFFSET_KEY}: {self.combined_offset:.5f}"
		else:
			msg = "no offsets defined"
		gcmd.respond_info(msg)

	desc_SET_RATOS_Z_OFFSET = "Set a RatOS Z offset."
	def cmd_SET_RATOS_Z_OFFSET(self, gcmd):
		name = gcmd.get('NAME').lower().strip()
		offset = gcmd.get_float('OFFSET')
		move = gcmd.get_int('MOVE', 0) == 1
		speed = gcmd.get_float('MOVE_SPEED', None, above=0.)
		self._validate_and_set_offset(name, offset)
		self._offset_changed(move, speed)

	desc_CLEAR_RATOS_Z_OFFSET = "Clear a RatOS Z offset. This is equivalent to setting the offset to zero."
	def cmd_CLEAR_RATOS_Z_OFFSET(self, gcmd):
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
		self.combined_offset = sum(self.offsets.values(), 0.)
		offset_delta = self.combined_offset - previous_offset

		if offset_delta == 0.:
			return

		gcode_move = self.gcode_move
		gcode_move.reset_last_position()

        # Move the toolhead by the given offset if requested.
		# This mimics the behaviour and implementation of SET_GCODE_OFFSET in gcode_move.py
		if move:
			speed = gcode_move.speed if move_speed is None else move_speed
			gcode_move.last_position[2] += offset_delta
			gcode_move.move_with_transform(gcode_move.last_position, speed)

		self._update_status()

	# For use by other extensions
	def set_offset(self, name:str, offset:float, should_move:bool=False, move_speed:float=None):
		"""Set a RatOS Z offset by name. If should_move is True, the toolhead will be moved by the offset."""
		if name:
			name = name.strip().lower()
		self._validate_and_set_offset(name, offset)
		self._offset_changed(should_move, move_speed)

	def _validate_and_set_offset(self, name, offset):
		"""Validate and set an offset value."""
		if name not in OFFSET_NAMES:
			raise self.gcode.error(f"Offset name '{name}' is not recognized.")
		if offset == 0.:
			self.offsets.pop(name, None)
		else:
			self.offsets[name] = float(offset)

	######
	# gcode_move transform compliance
	######
	def get_position(self):
		# Remove correction
		offset = self.combined_offset
		pos = self.next_transform.get_position()[:]
		pos[2] -= offset
		return pos

	def move(self, newpos, speed):
		# Apply correction
		offset = self.combined_offset
		pos = newpos[:]
		pos[2] += offset
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

def load_config(config):
	return RatOSZOffset(config)