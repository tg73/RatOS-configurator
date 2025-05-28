# Improve Beacon true zero consistency
#
# Copyright (C) 2025 Tom Glastonbury <t@tg73.net>
#
# This file may be distributed under the terms of the GNU GPLv3 license.

import math, logging
import numpy as np
from . import probe


# NOTE: Not tested with multi-beacon setup. The design seeks to pass through the SENSOR argument, so multi-beacon
#       *might* work, but this has not yet been tested.

BEACON_AUTO_CALIBRATE = 'BEACON_AUTO_CALIBRATE'
RATOS_TITLE = 'BEACON_AUTO_CALIBRATE Multi-point Probing'

class BeaconTrueZeroCorrection:
	def __init__(self, config):
		self.config = config
		self.printer = config.get_printer()
		self.reactor = self.printer.get_reactor()
		self.gcode = self.printer.lookup_object('gcode')
		self.name = config.get_name()        

		self.status = None
		self.ratos = None
		self.gm_ratos = None
		self.ratos_z_offset = None
		self.toolhead = None
		self.dual_carriage = None
		self.orig_cmd = None
		
		#######
		# Config
		#######

		# Allow the true zero correction to be disabled. This is useful for testing and debugging, and as an esacpe hatch.
		self.disabled = config.getboolean('disabled', False)

		# z values greater than z_rejection_threshold are rejected. These typically correspond to early triggering
		# of beacon contact before the nozzle has touched the bed. From test data, these are rare. Only 0.028% of samples
		# exceeded 75um (from over 32,000 samples across multiple machines and print surfaces).
		self.z_rejection_threshold = config.getfloat('z_rejection_threshold', 0.075, minval=0.03)

		# The number of times to probe an additional point if any z values are rejected.
		self.max_retries = config.getint('max_retries', 10, minval=0, maxval=15)

		# If true, each of the multiple probe locations will itself be probed several times using
		# the standard beacon error detection logic. From extensive testing, this mode offers no benefit
		# and should not be used. It is included only as an option for diagnostic purposes.
		self.use_error_corrected_probing = config.getboolean('use_error_corrected_probing', False)

		if self.disabled:
			logging.info(f"{self.name}: beacon true zero correction is disabled by configuration.")
			return
		
		if config.has_section('beacon'):
			self.printer.register_event_handler("klippy:connect",
												self._handle_connect)
			self.printer.register_event_handler("homing:home_rails_end",
												self._handle_homing_move_end)
			self.printer.register_event_handler("stepper_enable:motor_off",
												self._handle_motor_off)			
			
		else:
			logging.info(f"{self.name}: beacon is not configured, beacon true zero correction disabled.")
		
	def _handle_connect(self):
		self.ratos = self.printer.lookup_object('ratos')
		self.gm_ratos = self.printer.lookup_object('gcode_macro RatOS')
		self.ratos_z_offset = self.printer.lookup_object('ratos_z_offset')
		self.toolhead = self.printer.lookup_object("toolhead")

		if self.config.has_section("dual_carriage"):
			self.dual_carriage = self.printer.lookup_object("dual_carriage", None)

		self.orig_cmd = self.gcode.register_command(BEACON_AUTO_CALIBRATE, None)
		if self.orig_cmd == None:
			raise self.printer.config_error(f"{BEACON_AUTO_CALIBRATE} command is not registered, {self.name} cannot be enabled. Ensure that [beacon] occurs before [{self.name}] in the configuration.")
		
		self.gcode.register_command(
			BEACON_AUTO_CALIBRATE, 
			self.cmd_BEACON_AUTO_CALIBRATE,
			desc=self.desc_BEACON_AUTO_CALIBRATE)

	def _handle_homing_move_end(self, homing_state, rails):
		# Clear the true zero correction offset if the Z axis is homed.
		# Any existing true zero correction is invalidated when z is re-homed.		
		if 2 in homing_state.get_axes():
			self.ratos_z_offset.set_offset('true_zero_correction', 0)

	def _handle_motor_off(self, print_time):
		# Clear the true zero correction offset if motors are disabled.
		# Any existing true zero correction is invalidated when z is disabled.
		self.ratos_z_offset.set_offset('true_zero_correction', 0)

	######
	# commands
	######
	def _check_homed(self, msg = 'Must home all axes first'):
		status = self.toolhead.get_status(self.reactor.monotonic())
		homed_axes = status["homed_axes"]
		if any(axis not in homed_axes for axis in "xyz"):
			raise self.gcode.error( msg )
				
	desc_BEACON_AUTO_CALIBRATE = "Automatically calibrates the Beacon probe. Extended with RatOS multi-point probing for improved true zero consistency. Use SKIP_MULTIPOINT_PROBING=1 to bypass."
	def cmd_BEACON_AUTO_CALIBRATE(self, gcmd):
		# Clear existing offset
		self.ratos_z_offset.set_offset('true_zero_correction', 0)

		skip = gcmd.get('SKIP_MULTIPOINT_PROBING', '').lower() in ('1', 'true', 'yes')
		if skip:
			return self.orig_cmd(gcmd)
		
		zero_xy = self.toolhead.get_position()[:2]
		retval = self.orig_cmd(gcmd)
		self._check_homed()
		ps = ProbingSession(self, gcmd, zero_xy)
		ps.run()

		return retval

class ProbingSession:
	
	def __init__(self, tzc:BeaconTrueZeroCorrection, gcmd, zero_xy_position):
		self.gcmd = gcmd
		self.tzc = tzc
		self.zero_xy_position = zero_xy_position
		self.max_retries = tzc.max_retries
		self.retries = 0
		self.probe_helper = probe.ProbePointsHelper(self.tzc.config, self._probe_finalize, [])
		self._finalize_result = None
		self._has_run = False
		self._points = None
		self._next_points_index = 0

		# NOTE: The following values are hard-coded for now, but could be made configurable in the future.

		# The take-7-drop-4-max approach was determined from extensive testing, with a wide range of
		# print surfaces and printers. Statistical analysis of the data shows that this approach
		# provides a significantly-enhanced level of confidence that the true zero correction is
		# accurate and has significantly increased immunity to local location-dependent variation
		# in probe results.

		# Number of samples to take, including the implied zero sample from BEACON_AUTO_CALIBRATE
		self._take = 7
		# Number of maximal-valued samples to discard
		self._drop_top = 4
		# The zero-value initial sample is implied from BEACON_AUTO_CALIBRATE, which is expected to have
		# been invoked immediatley prior to this command, at the same location.
		self._samples = [0.]

	def run(self):
		if self._has_run:
			raise Exception("ProbingSession has already been run, and cannot be run more than once.")
		self._has_run = True
				
		num_points_to_generate = self._take - len(self._samples) + self.max_retries
		min_span = 9.

		nozzle_tip_dia = self._get_nozzle_tip_diameter()
		
		# Calculate the nozzle-based min span as the length of the side of a
		# square with area four times the footprint of COUNT nozzle tips.
		nozzle_based_min_span = math.sqrt(math.pi * (nozzle_tip_dia/2)**2 * num_points_to_generate * 4.)
		span = max(min_span, nozzle_based_min_span)
		half_span = span / 2.		

		logging.info(f"{self.tzc.name}: count: {num_points_to_generate}  min_span: {min_span}  nozzle_tip_dia: {nozzle_tip_dia:.3f}  nozzle_based_min_span: {nozzle_based_min_span:.2f}  use_span: {span:.2f}")
		
		# Calculate probing region
		range_x = (self.zero_xy_position[0] - half_span, self.zero_xy_position[0] + half_span)
		range_y = (self.zero_xy_position[1] - half_span, self.zero_xy_position[1] + half_span)

		self._validate_probing_region(range_x, range_y, span)

		probe_gcmd = self._prepare_probe_command()

		self._points = self._generate_points(num_points_to_generate, range_x, range_y, nozzle_tip_dia)
		self._next_points_index = self._take - len(self._samples)
		self.probe_helper.update_probe_points(self._points[:self._next_points_index], 1)
		self.probe_helper.start_probe(probe_gcmd)
	
		self._finalize()
	
	def _finalize(self):
		if self._finalize_result == 'retry':
			self.tzc.ratos.console_echo(
				RATOS_TITLE, 
				'error', 
				'One or more z values were out of range, maximum retries exceeded.')
			raise self.gcmd.error('One or more z values were out of range, maximum retries exceeded.')
		elif isinstance(self._finalize_result, float):
			if self._finalize_result < -0.2:
				# Sanity check to reduce the risk of bed damage
				self.tzc.ratos.console_echo(
					RATOS_TITLE, 
					'error', 
					f'The measured true zero correction {self._finalize_result:.6f} is below the safety limit of -0.2mm._N_This is not expected behaviour.')
				raise self.gcmd.error(f'Measured correction is below safety limit')
			logging.info(f'{self.tzc.name}: applying correction {self._finalize_result:.6f}')
			self.gcmd.respond_info(f'Applying true zero correction of {self._finalize_result*1000.:.1f} µm')
			self.tzc.ratos_z_offset.set_offset('true_zero_correction', self._finalize_result)
		else:
			raise ValueError('Internal error: unexpected value for _finalize_result')

	def _validate_probing_region(self, range_x, range_y, span):
		printable_x = (self.tzc.gm_ratos.variables.get('printable_x_min'), self.tzc.gm_ratos.variables.get('printable_x_max'))
		printable_y = (self.tzc.gm_ratos.variables.get('printable_y_min'), self.tzc.gm_ratos.variables.get('printable_y_max'))

		def in_range(r, value):
			return r[0] <= value <= r[1]

		if not (
			in_range(printable_x, range_x[0]) and in_range(printable_x, range_x[1]) and
			in_range(printable_y, range_y[0]) and in_range(printable_y, range_y[1])):

			self.tzc.console_echo(RATOS_TITLE, 'error', f'The required probing region ({span:.1f}x{span:.1f}) would probe outside the printable area.')
			raise self.gcmd.error('The required probing region would probe outside the printable area')

	def _prepare_probe_command(self):
		probe_args = dict(
			PROBE_METHOD='contact',
			SAMPLES='1',
			SAMPLES_DROP='0'
		) if not self.tzc.use_error_corrected_probing else dict(
			PROBE_METHOD='contact',
			SAMPLES='3',
			SAMPLES_DROP='1',
			SAMPLES_TOLERANCE_RETRIES='10'
		)

		sensor = self.gcmd.get('SENSOR', None)
		if sensor:
			probe_args['SENSOR'] = sensor

		return self.tzc.gcode.create_gcode_command(
			self.gcmd.get_command(),
			self.gcmd.get_command()
				+ "".join(" " + k + "=" + v for k, v in probe_args.items()),
			probe_args
		)

	def _probe_finalize(self, _, positions):
		zvals = [p[2] for p in positions]
		logging.info(f'{self.tzc.name}: probed z-values: {", ".join(f"{z:.6f}" for z in zvals)}')
		good = [z for z in zvals if z < self.tzc.z_rejection_threshold]
		self._samples.extend(good)
		if len(self._samples) == self._take:
			# Gathered enough good samples
			self._samples.sort()
			use_samples = self._samples[:-self._drop_top]
			logging.info(f'{self.tzc.name}: samples: {", ".join(f"{z:.6f}" for z in self._samples)}  using: {", ".join(f"{z:.6f}" for z in use_samples)}')
			self._finalize_result = float(np.mean(use_samples))
			return 'done'
		
		rejects = [z for z in zvals if z >= self.tzc.z_rejection_threshold]
		logging.info(f'{self.tzc.name}: rejected z-values: {", ".join(f"{z:.6f}" for z in rejects)}')

		if self._next_points_index + len(rejects) <= len(self._points):
			self.retries += 1
			self.gcmd.respond_info(f'{len(rejects)} z value(s) were out of range, probing additional point(s)')
			logging.info(f'{self.tzc.name}: will probe additional {len(rejects)}')
			self.probe_helper.update_probe_points(self._points[self._next_points_index:self._next_points_index + len(rejects)], 1)
			self._next_points_index += len(rejects)
			return 'retry'
		
		self.gcmd.respond_info(f'{len(rejects)} z value(s) were out of range, exceeding the number of available retry points.')
		self._finalize_result = 'retry'
		return 'done'
	
	def _generate_points(self, n, x_lim, y_lim, min_dist, avoid_centre=True, max_iter=1000):
		points = []
		centre = [np.mean(x_lim), np.mean(y_lim)]
		iterations = 0

		while len(points) < n and iterations < max_iter:
			# Generate a candidate point uniformly within the given x and y limits.
			candidate = np.array([np.random.uniform(x_lim[0], x_lim[1]),
								np.random.uniform(y_lim[0], y_lim[1])])
			
			# Check that candidate is at least min_dist away from every existing point.
			if ((not avoid_centre) or np.linalg.norm(candidate - centre) >= min_dist) \
				and all(np.linalg.norm(candidate - p) >= min_dist for p in points):
					points.append(candidate.tolist()) # don't leak numpy types
			
			iterations += 1
		
		if len(points) < n:
			raise self.gcode.error(
				"Could not generate all required probe points within the specified iteration limit. "
				"The conditions are too strict.")
		
		return points

	def _get_nozzle_diameter(self):
		extruder_name = 'extruder'
		
		if self.tzc.dual_carriage and self.tzc.dual_carriage.dc[1].mode.lower() == 'primary':
			extruder_name = 'extruder1'
		
		extruder = self.tzc.printer.lookup_object(extruder_name)
		nozzle_diameter = extruder.nozzle_diameter
		return nozzle_diameter
	
	def _get_nozzle_tip_diameter(self, nozzle_diameter=None):
		if nozzle_diameter is None:
			nozzle_diameter = self._get_nozzle_diameter()
		
		# Based on V6 standard, total nozzle tip diameter is typically 2.5 times hole diameter (spec'd up to 0.8mm),
		# except below 0.25mm where it's 1.5 times hole diameter. FIN specifies 2.0 times hole diameter.
		# Slice GammaMaster 2.4mm nozzle has ~3.75mm tip (from their published STEP model), a multiplier
		# of 1.56, or an increase of 1.35. Here we make some effort at a reasonable approximation.
		if nozzle_diameter < 0.25:
			nozzle_tip_dia = 1.5 * nozzle_diameter
		elif nozzle_diameter <= 0.8:
			nozzle_tip_dia = 2.5 * nozzle_diameter
		else:
			nozzle_tip_dia = nozzle_diameter + 1.35
		
		return nozzle_tip_dia
	
# Register the configuration
def load_config(config):
	return BeaconTrueZeroCorrection(config)