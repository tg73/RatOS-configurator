# Adaptive heat soak with thermal stability detection using Beacon proximity sensor data
#
# Copyright (C) 2025 Tom Glastonbury <t@tg73.net>
#
# This file may be distributed under the terms of the GNU GPLv3 license.

import math, datetime, time, struct, logging
import numpy as np
from . import probe
from multiprocessing import shared_memory, Process, Pipe

class BeaconZRateSession:
	def __init__(self, config, beacon, reactor):
		self.config = config
		self.name = config.get_name()
		self.beacon = beacon
		self.reactor = reactor
		self._shm = None
		self._float_size = struct.calcsize('d')  # Size of double in bytes
		
	def cleanup(self):
		if self._shm is not None:
			self._shm.close()
			self._shm.unlink()
			self._shm = None
	
	def _ensure_shared_memory(self, size):
		# Ensure the shared memory is large enough. Don't bother shrinking it.		
		if self._shm is None or self._shm.size < size * self._float_size:
			if self._shm is not None:
				self._shm.close()
				self._shm.unlink()
			self._shm = shared_memory.SharedMemory(create=True, size=size * self._float_size)
			
	def get_z_rate(self, sample_count):
		if sample_count <= 2:
			raise ValueError("Sample count must be greater than 2 to calculate a rate.")
		
		# Time values are stored in the first sample_count elements of the shared memory, and distances
		# in the second sample_count elements.
		self._ensure_shared_memory(sample_count * 2)
		samples = memoryview(self._shm.buf).cast('d')
		i = 0

		def cb(s):
			nonlocal i, samples
			if i < sample_count:
				# s["dist"] is the smoothed distance, we want the unsmoothed data as this is
				# cleaner for rate calculations.
				time = s["time"]
				temp = s["temp"]
				data = s["data"]
				freq = self.beacon.count_to_freq(data)
				dist = self.beacon.freq_to_dist(freq, temp)
				samples[i] = time
				samples[sample_count + i] = dist
				i += 1
				
		with self.beacon.streaming_session(cb):
			eventtime = self.reactor.monotonic()
			while i < sample_count:
				eventtime = self.reactor.pause(eventtime + 0.1)			
		
		mid_time = (samples[0] + samples[sample_count - 1]) / 2
		duration = samples[sample_count - 1] - samples[0]
		logging.info(f"{self.name}: Captured {i} samples over {duration:.2f} seconds at mid_time {mid_time:.2f}")

		# Set up a pipe to communicate with the child process
		parent_conn, child_conn = Pipe()

		child = Process(target=BeaconZRateSession._calculate_z_rate, args=(child_conn, self._shm.name, sample_count))
		child.daemon = True
		child.start()

		eventtime = self.reactor.monotonic()

		while child.is_alive():
			eventtime = self.reactor.pause(eventtime + 0.1)

		is_err, result = parent_conn.recv()
		
		child.join()
		parent_conn.close()
		
		if is_err:
			raise Exception(f"Error calculating z-rate: {result}")
		else:
			return (mid_time, result)
	
	@staticmethod
	def _calculate_z_rate(conn, shm_name, sample_count):
		try:
			shm = None
			try:
				shm = shared_memory.SharedMemory(name=shm_name)
				samples = memoryview(shm.buf).cast('d')
				
				if len(samples) < sample_count * 2:
					raise ValueError("Not enough samples in shared memory")

				# Time values are stored in the first sample_count elements of the shared memory, and distances
				# in the second sample_count elements. The shared memory may be larger than sample_count * 2,
				# so we take care to only use the first sample_count * 2 values.
				coefficients = np.polyfit(
					samples[:sample_count],
					samples[sample_count:sample_count * 2], 1)
				
				slope = coefficients[0]  		# The slope of the line is the rate of change				
				slope_nm_per_sec = slope * 1e6 	# Convert from millimeters to nanometers per second
				conn.send((False, slope_nm_per_sec))
			finally:
				if shm is not None:
					shm.close()			
		except Exception as e:
			conn.send((True, str(e)))
		finally: 
			conn.close()

class BeaconAdaptiveHeatSoak:
	def __init__(self, config):
		self.config = config
		self.name = config.get_name()
		self.printer = config.get_printer()
		self.reactor = self.printer.get_reactor()
		self.gcode = self.printer.lookup_object('gcode')
		
		# Configuration values
		self.threshold = config.getfloat('threshold', 0.001, 
									   above=0.0, below=1.0)
		self.default_horizontal_move_z = config.getfloat('horizontal_move_z', 5., minval=1.0)
		self.speed = config.getfloat('speed', 50., above=0.)
		self.lift_speed = config.getfloat('lift_speed', self.speed, above=0.)
		self.maximum_wait = config.getint('maximum_wait', 3600, minval=0)
		self.home_position_only = config.getboolean('home_position_only', False)

		# Setup
		self.reactor = None
		self.ratos = None
		self.beacon = None
		self.default_probe_points = None
		self.toolhead = None
		self.first_run = True

		if not self.home_position_only and config.get('points', None) is not None:
			self.default_probe_points = config.getlists('points', seps=(',', '\n'),
                                                parser=float, count=2)			

		# Register commands
		self.gcode.register_command(
			'BEACON_WAIT_FOR_PRINTER_HEAT_SOAK', 
			self.cmd_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK,
			desc=self.desc_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK)

		self.gcode.register_command(
			'_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_BEACON_SAMPLES',
			self.cmd_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_BEACON_SAMPLES,
			desc=self.desc_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_BEACON_SAMPLES)

		self.gcode.register_command(
			'_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_Z_RATES',
			self.cmd_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_Z_RATES,
			desc=self.desc_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_Z_RATES)

		self.printer.register_event_handler("klippy:connect",
											self._handle_connect)

	def _handle_connect(self):
		self.reactor = self.printer.get_reactor()
		self.toolhead = self.printer.lookup_object("toolhead")
		self.ratos = self.printer.lookup_object("ratos")

		if self.config.has_section("beacon"):
			self.beacon = self.printer.lookup_object('beacon')

		if not self.home_position_only and self.default_probe_points is None:
			beacon_regions = self.ratos.get_beacon_probing_regions()
			if beacon_regions is not None:
				# Generate points in clockwise order starting from top middle (12 o'clock)
				x_min, y_min = beacon_regions.proximity_min
				x_max, y_max = beacon_regions.proximity_max
				mid_x = x_min + (x_max - x_min) / 2
				mid_y = y_min + (y_max - y_min) / 2
				# Put the points in a clockwise order for nice toolhead movement path.
				self.default_probe_points = (
					(mid_x, y_max),          # 12 o'clock
					(x_max, y_max),          # 1:30
					(x_max, mid_y),          # 3 o'clock 
					(x_max, y_min),          # 4:30
					(mid_x, y_min),          # 6 o'clock
					(x_min, y_min),          # 7:30
					(x_min, mid_y),          # 9 o'clock
					(x_min, y_max),          # 10:30
					(mid_x, mid_y)           # center point
				)

	def _handle_first_run(self):
		# We've seen issues where the first streaming_session after a restart begins with some bogus data,
		# so we throw away some samples to ensure the beacon is ready.
		if self.first_run:
			self.first_run = False
			i = 0
			def cb(_):
				nonlocal i
				i += 1
			with self.beacon.streaming_session(cb):
				# Wait for 1000 samples to be collected
				eventtime = self.reactor.monotonic()				
				while i < 1000:					
					eventtime = self.reactor.pause(eventtime + 0.1)
	
	def _monotonic_to_wall_clock(self, monotonic_timestamp):
		baseline_monotonic = self.reactor.monotonic()
		baseline_wall_time = time.time()
		elapsed = monotonic_timestamp - baseline_monotonic
		wall_timestamp = baseline_wall_time + elapsed
		return datetime.fromtimestamp(wall_timestamp)
				
	desc_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK = "Wait for printer to reach thermal stability using Beacon to monitor deflection changes"
	def cmd_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK(self, gcmd):
		if self.beacon is None:
			raise self.printer.command_error("Beacon is not available. Please ensure RatOS is configured correctly.")

		self._handle_first_run()

		primary_soak_position = self.toolhead.get_position()

		if self.default_probe_points is not None:
			# Skip any default probe points that are close to the primary soak position, there's no point probing them.
			ref_pos = np.array(primary_soak_position[:2])
			min_distance_from_primary_soak_position = 80
			probe_points = [p for p in self.default_probe_points if np.linalg.norm(np.array(p) - ref_pos) >= min_distance_from_primary_soak_position]
		else:
			probe_points = None

		maximum_wait = gcmd.get_int('MAXIMUM_WAIT', 90, minval=0)
		samples = gcmd.get_int('SAMPLES', 15000, minval=500)

		start_time = self.reactor.monotonic()

		z_rate_session = None
		try:
			z_rate_session = BeaconZRateSession(self.config, self.beacon, self.reactor)
			#max_history_length = 10
			history = []
			while True:
				if self.reactor.monotonic() - start_time > maximum_wait:
					gcmd.respond_info(f"Maximum wait time of {maximum_wait} seconds exceeded, exiting.")
					return

				# Get the Z rate from the beacon
				try:
					z_rate_result = z_rate_session.get_z_rate(samples)
				except Exception as e:
					raise self.printer.command_error(f"Error calculating Z rate: {e}")

				gcmd.respond_info(f"Z rate {z_rate_result[1]:.3f} nm/s")

				history.append(z_rate_result)
				# if len(history) > max_history_length:
				# 	history.pop(0)

				# # Fit a second-degree polynomial (quadratic) to the data.
				# coefs = np.polyfit([h[0] for h in history],
				# 				   [h[1] for h in history], 2)
				
				# poly = np.poly1d(coefs)
				
				# if abs(z_rate) < self.threshold:
				# 	gcmd.respond_info(f"Thermal stability detected with Z rate {z_rate:.3f} nm/s, exiting.")
				# 	return

				# gcmd.respond_info(f"Z rate {z_rate:.3f} nm/s exceeds threshold {self.threshold}, continuing to wait...")

		finally:
			if z_rate_session is not None:
				z_rate_session.cleanup()

	def _predict_future_crossing(self, poly, target_value, after):
		# To predict when the trend will reach the target_value, solve:
		#     p(x) = target_value  <=>  p(x) - target_value = 0

		# Create the new polynomial q(x) = p(x) - target_value.
		q = poly - target_value

		# Compute the roots of q.
		roots = q.r

		# Filter out the real roots.
		real_roots = [root.real for root in roots if np.isreal(root)]

		# Often, you want to predict a *future* event.
		# For example, if x represents time, choose real roots greater than the latest x value.
		future_roots = [root for root in real_roots if root > after]

		if future_roots:
			# Choose the earliest future time as the predicted crossing.
			predicted_x = min(future_roots)
			
			# Compute the derivative of the fitted polynomial to obtain the slope.
			dp = poly.deriv()
			predicted_slope = dp(predicted_x)
			
			print(f"Predicted time (x) when y reaches {target_value}: {predicted_x}")
			print(f"Predicted slope at that time: {predicted_slope}")

		else:
			print(f"No future crossing found where y reaches {target_value} based on the available data.")

	desc_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_Z_RATES = "For developer use only. This command is used to run diagnostics for Beacon adaptive heat soak."
	def cmd_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_Z_RATES(self, gcmd):
		if self.beacon is None:
			raise self.printer.command_error("Beacon is not available. Please ensure RatOS is configured correctly.")

		self._handle_first_run()

		duration = gcmd.get_int('DURATION', 7200, minval=0)
		samples = gcmd.get_int('SAMPLES', 30000, minval=1000)

		timestamp = time.strftime("%Y%m%d_%H%M%S")
		filename = f'/home/pi/printer_data/config/beacon_adaptive_heat_soak_z_rates_{timestamp}.txt'

		# Make sure we can open the file before starting capture
		with open(filename, 'w') as f:
			gcmd.respond_info(f'Capturing diagnostic z-rates for {duration} seconds using {samples} samples per z-rate calculation to file {filename}, please wait...')
			start_time = self.reactor.monotonic()
			z_rate_session = None
			try:
				z_rate_session = BeaconZRateSession(self.config, self.beacon, self.reactor)
				history = []
				time_zero = None
				while self.reactor.monotonic() - start_time < duration:
					# Get the Z rate from the beacon
					try:
						z_rate_result = z_rate_session.get_z_rate(samples)
					except Exception as e:
						raise self.printer.command_error(f"Error calculating Z rate: {e}")

					gcmd.respond_info(f"Z rate {z_rate_result[1]:.3f} nm/s")

					if time_zero is None:
						time_zero = z_rate_result[0]

					history.append((z_rate_result[0] - time_zero, z_rate_result[1]))

				np.savetxt(f, history)
				gcmd.respond_info(f'Diagnostic data captured to {filename}')
			finally:
				if z_rate_session is not None:
					z_rate_session.cleanup()

	desc_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_BEACON_SAMPLES = "For developer use only. This command is used to run diagnostics for Beacon adaptive heat soak."
	def cmd_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_BEACON_SAMPLES(self, gcmd):
		if self.beacon is None:
			raise self.printer.command_error("Beacon is not available. Please ensure RatOS is configured correctly.")
		
		self._handle_first_run()

		duration = gcmd.get_int('DURATION', 300, minval=60)
		chunk_duration = gcmd.get_int('CHUNK_DURATION', 5, minval=5)

		timestamp = time.strftime("%Y%m%d_%H%M%S")
		filename = f'/home/pi/printer_data/config/beacon_adaptive_heat_soak_beacon_samples_{timestamp}.txt'

		with open(filename, 'w') as f:
			gcmd.respond_info(f'Capturing diagnostic beacon samples for {duration} seconds in chunks of {chunk_duration} seconds to file {filename}, please wait...')
			start_time = self.reactor.monotonic()
			while self.reactor.monotonic() - start_time < duration:
				samples = []
				def cb(s):					
					unsmooth_data = s["data"]
					unsmooth_freq = self.beacon.count_to_freq(unsmooth_data)
					unsmooth_dist = self.beacon.freq_to_dist(unsmooth_freq, s["temp"])
					samples.append((s["time"], s["dist"], unsmooth_dist))

				with self.beacon.streaming_session(cb):
					self.reactor.pause(self.reactor.monotonic() + chunk_duration)

				np.savetxt(f, samples)
				f.flush()

		gcmd.respond_info(f'Diagnostic data captured to {filename}')

def load_config(config):
	return BeaconAdaptiveHeatSoak(config)