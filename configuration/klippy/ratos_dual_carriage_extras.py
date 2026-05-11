# Enhancements and utilities for printers with a dual carriage axis
#
# Copyright (C) 2026 Tom Glastonbury <t@tg73.net>
#
# This file may be distributed under the terms of the GNU GPLv3 license.

import logging

class RatOSDualCarriageExtras:
	def __init__(self, config):
		self.name = config.get_name()
		self.printer = config.get_printer()

		if not config.has_section("dual_carriage"):
			logging.info(f"{self.name}: configuration section [dual_carriage] not found, {self.name} will not be initialized.")
			return

		self.auto_align_on_mode_change = config.getboolean('auto_align_on_mode_change', True)

		self.gcode = self.printer.lookup_object('gcode')
		self.gcode_move = self.printer.lookup_object('gcode_move')
		self.ratos = self.printer.lookup_object('ratos')
		
		self.next_transform = None
		self.dual_carriage = None
		self.dc_axis_index = None
		self.dc_axis_name = None
		self._original_set_dual_carriage_cmd = None

		self.printer.register_event_handler("klippy:connect", self._connect)

	def _connect(self):
		self.dual_carriage = self.printer.lookup_object("dual_carriage", None)
		self.dc_axis_index = self.dual_carriage.axis
		self.dc_axis_name = {0: 'x', 1: 'y'}[self.dual_carriage.axis]

		self._original_set_dual_carriage_cmd = self._override_command('SET_DUAL_CARRIAGE', self.override_SET_DUAL_CARRIAGE, desc_suffix=self.desc_suffix_SET_DUAL_CARRIAGE)
	
	def _override_command(self, cmd_name, new_cmd, *, when_not_ready:bool=False, desc:str=None, desc_suffix:str=None):
		if desc is None:
			desc = self.gcode.get_command_help().get(cmd_name, None)

		if desc_suffix is not None:
			if desc is None:
				desc = desc_suffix
			else:
				if not desc.endswith('.'):
					desc = desc + '.'
				desc = desc + ' ' + desc_suffix

		is_base_handler = self.gcode.base_gcode_handlers.get(cmd_name, None) is not None
		
		if is_base_handler != when_not_ready:
			raise self.printer.config_error(f"{cmd_name} is {'' if is_base_handler else 'not '}a base (aka 'when-not-ready') gcode handler, this is not expected. {self.name} cannot be enabled.")
		
		original_cmd = self.gcode.register_command(cmd_name, None)
		
		if original_cmd is None:
			raise self.printer.config_error(f"An existing {cmd_name} command is not registered, {self.name} cannot be enabled. Make sure that [beacon] is declared before [{self.name}] in printer.cfg.")

		self.gcode.register_command(cmd_name, new_cmd, when_not_ready=when_not_ready, desc=desc)
		return original_cmd

	desc_suffix_SET_DUAL_CARRIAGE = "Enhanced by RatOS to first align toolhead to kinematic position, to prevent potential positional drift due to sub-microstep rounding behaviours. Use SKIP_ALIGN=1 to skip the alignment if desired."
	def override_SET_DUAL_CARRIAGE(self, gcmd):
		skip_align = gcmd.get('SKIP_ALIGN', '').lower() in ('true', 'yes', '1')
		if self.auto_align_on_mode_change and not skip_align:
			self._align_to_kinematic_position(self.dc_axis_name)
		self._original_set_dual_carriage_cmd(gcmd)

	def _align_to_kinematic_position(self, axis_name):
		"""
		Align toolhead to kinematic position on the specified axis, if the discrepancy is within a reasonable threshold.
		
		Parameters:
			axis_name (str): The axis to align, one of 'x', 'y', or 'z' (case-insensitive).		
		"""
		# This is intended to correct sub-microstep offsets that can arise between the toolhead position
		# and the kinematic position. Such offsets can result in positional drift when changing dual carriage modes,
		# typically of one microstep distance per cycle of mode changes (eg, T0->T1->T0) - the MCU step count
		# drifts while the calculated kinematic position does not. This drift does not always happen: it
		# appears to depend on some discrepancy in rounding at different layers of the motion system that is not
		# fully round-tripable.
		#
		# The simple safety rule is: don't change dual carriage mode when the toolhead position is not at a
		# microstep boundary on the dual carriage axis (typically the X axis).
		if len(axis_name) != 1 or axis_name not in 'xyz':
			raise self.gcode.error(f"Invalid axis_name: '{axis_name}'. Must be one of x, y, or z.")
		axis_index = 'xyz'.index(axis_name)
		axis_name_upper = axis_name.upper()

		toolhead = self.printer.lookup_object('toolhead')
		toolhead.flush_step_generation()
		kin = toolhead.get_kinematics()
		steppers = kin.get_steppers()

		stepper_positions_list = [(s.get_name(), s.get_commanded_position()) for s in steppers]
		stepper_positions = dict(stepper_positions_list)
		kin_pos = kin.calc_position(stepper_positions)

		toolhead_pos = toolhead.get_position()
		
		kin_ap = kin_pos[axis_index]
		toolhead_ap = toolhead_pos[axis_index]
		delta = abs(kin_ap - toolhead_ap)
		
		if delta < 1e-9:
			logging.debug(f"{self.name}: _align_to_kinematic_position: toolhead is already aligned to kinematic position on axis {axis_name_upper} (delta {delta:.6f}), no action needed.")
			return

		# Note that *by definition*, after flush_step_generation(), the kinematic and toolhead positions
		# should not differ by more than a microstep. We perform a belt and braces sanity check out of
		# an abundance of caution, and to provide a more informative message if the positions appear
		# significantly misaligned.
		#
		# Determine the minimum change in kinematic position on the specified axis that could result
		# in a change in commanded stepper position any of the steppers that affect this axis. We will
		# not perform a move if the discrepancy is larger than this, as a) it would cause an actual
		# physical move; and b) this is not an expected scenario and indicates a misunderstanding or
		# fault state that should be investigated rather than automatically corrected.
		#
		# We simulate moves in both directions for each stepper, as the cartesian result may differ
		# for non-linear kinematics.
		max_no_stepper_move_distance = None
		for stepper in steppers:
			name = stepper.get_name()
			step_dist = stepper.get_step_dist()
			
			# Check the forward step (+1)
			steppers_forward = dict(stepper_positions)
			steppers_forward[name] += step_dist
			kin_forward = kin.calc_position(steppers_forward)
			one_step_shift_forward = abs(kin_forward[axis_index] - kin_pos[axis_index])
			
			# Check the backward step (-1)
			steppers_backward = dict(stepper_positions)
			steppers_backward[name] -= step_dist
			kin_backward = kin.calc_position(steppers_backward)
			one_step_shift_backward = abs(kin_backward[axis_index] - kin_pos[axis_index])
			
			min_step_shift = min(one_step_shift_forward, one_step_shift_backward)

			# min_step_shift will be zero for inactive steppers (eg, the inactive carriage in dual carriage),
			# ignore those as they do not affect the position on this axis.
			if min_step_shift < 1e-9:
				continue

			if max_no_stepper_move_distance is None or min_step_shift < max_no_stepper_move_distance:
				max_no_stepper_move_distance = min_step_shift

		if max_no_stepper_move_distance is None:
			# This should not happen, as there should be at least one stepper affecting each axis, but we check just in case.
			# Note: we don't raise an error here because we don't want to cause a failure in this command if the kinematics are in some unexpected state; we just won't perform the alignment.
			logging.error(f"{self.name}: _align_to_kinematic_position: could not determine the minimum stepper move distance for {axis_name_upper} axis: no steppers found affecting this axis.")
			return
		
		# floating point boundary allowance
		max_no_stepper_move_distance += 1e-7
		
		curtime = self.printer.get_reactor().monotonic()
		is_homed = axis_name in kin.get_status(curtime)['homed_axes']
		is_sensible = delta <= max_no_stepper_move_distance

		if not is_sensible:
			logging.error(
				f"{self.name}: _align_to_kinematic_position: divergence between toolhead position and kinematic {axis_name_upper} position exceeds safe threshold of {max_no_stepper_move_distance:.9f}:\n"
				f"kinematic: {kin_ap:.6f}, toolhead: {toolhead_ap:.6f}, delta: {delta:.9f}\n"
				"Alignment skipped to avoid unexpected physical move.")
		elif not is_homed:
			logging.debug(f"{self.name}: _align_to_kinematic_position: {axis_name_upper} axis is not homed; skipping alignment")
		else:
			logging.info(f"{self.name}: _align_to_kinematic_position: aligning toolhead to kinematic position for {axis_name_upper} axis: {toolhead_ap:.6f} -> {kin_ap:.6f} (delta {delta:.6f}, safe threshold {max_no_stepper_move_distance:.6f})")
			pos = [None] * 4
			pos[axis_index] = kin_pos[axis_index]
			toolhead.manual_move(pos, 100.)

#####
# Loader
#####
def load_config(config):
	return RatOSDualCarriageExtras(config)
