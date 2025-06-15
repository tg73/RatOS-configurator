# Adaptive heat soak with thermal stability detection using Beacon proximity sensor data
#
# Copyright (C) 2025 Tom Glastonbury <t@tg73.net>
#
# This file may be distributed under the terms of the GNU GPLv3 license.

import re, time, logging
import numpy as np

class BeaconZRateSession:
	def __init__(self, config, beacon, samples_per_mean=1000, window_size=30, window_step=1):
		self.config = config
		self.name = config.get_name()
		self.printer = config.get_printer()
		self.gcode = self.printer.lookup_object('gcode')
		self.reactor = self.printer.get_reactor()
		self.beacon = beacon
		self.samples_per_mean = samples_per_mean
		self.window_size = window_size
		self.window_step = window_step

		self._mean_distances = []
		self._times = []
		self._sample_buffer = np.zeros(samples_per_mean, dtype=np.float64)
		self._step_phase = window_step - window_size # Ensure that phase will be 0 after populating the initial window_size means

	def _get_next_mean(self):

		first_sample_time = None
		last_sample_time = None
		bad_sample_count = 0
		i = 0

		def cb(s):
			nonlocal i, bad_sample_count, first_sample_time, last_sample_time
			if i < self.samples_per_mean:
				dist = s["dist"]
				if dist is None or np.isinf(dist) or np.isnan(dist):
					bad_sample_count += 1
				else:
					self._sample_buffer[i] = dist
					if i == 0:
						first_sample_time = s["time"]

					i += 1

					if i == self.samples_per_mean:
						last_sample_time = s["time"]

		with self.beacon.streaming_session(cb):
			eventtime = self.reactor.monotonic()
			while i < self.samples_per_mean:
				eventtime = self.reactor.pause(eventtime + 0.1)
				if bad_sample_count > 100:
					# Not expected. Could be that thermal deflection moved the beacon out of range (too close or too far from the bed).
					# We've not seen this happen in practice, but we handle it gracefully just in case.
					raise self.printer.command_error(f"{self.name}: Unexpected error: Beacon failed to measure a valid distance for {bad_sample_count} out of {bad_sample_count + i} samples.")

		if bad_sample_count > 0:
			logging.warning(f"{self.name}: {bad_sample_count} out of {bad_sample_count + i} samples were invalid.")

		self._step_phase = (self._step_phase + 1) % self.window_step

		# Beacon samples are approximately evenly spaced, so we can use the first and last sample times to calculate the mean time.
		mean_time = (first_sample_time + last_sample_time) / 2
		return (mean_time, np.mean(self._sample_buffer))

	def get_next_z_rate(self):
		while True:
			if len(self._mean_distances) == self.window_size:
				self._mean_distances.pop(0)
				self._times.pop(0)

			# The first call to get_next_z_rate will fill the means list with initial values,
			# subsequent calls will use the sliding window approach.
			while len(self._mean_distances) < self.window_size:
				time, mean = self._get_next_mean()
				self._mean_distances.append(mean)
				self._times.append(time)

			if self._step_phase == 0:
				break

		# Fit a 1-degree polynomial (line) to the data
		slope, _ = np.polyfit(self._times, self._mean_distances, 1)

		# Convert from millimeters to nanometers per second
		slope_nm_per_sec = slope * 1e6

		return (self._times[len(self._times) // 2], slope_nm_per_sec)

class BeaconAdaptiveHeatSoak:
	def __init__(self, config):
		self.config = config
		self.name = config.get_name()
		self.printer = config.get_printer()
		self.reactor = self.printer.get_reactor()
		self.gcode = self.printer.lookup_object('gcode')

		# Configuration values

		# The default z-rate threshold in nm/s below which we consider the printer to be thermally stable.
		self.def_threshold = config.getint('threshold', 15, minval=10)

		# The default number of continuous seconds with z-rate below the threshold before we consider the
		# printer to be thermally stable.
		self.def_hold_count = config.getint('hold_count', 150, minval=1)

		# The default maximum wait time in seconds for the printer to reach thermal stability.
		self.def_maximum_wait = config.getint('maximum_wait', 5400, minval=0)

		# TODO: Make trend checks configurable.

		# Setup
		self.reactor = None
		self.beacon = None

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

		if self.config.has_section("beacon"):
			self.beacon = self.printer.lookup_object('beacon')

	def _prepare_for_sampling(self):
		# We've seen issues where the first streaming_session after some operations begins with some bogus data,
		# so we throw away some samples to ensure the beacon is ready. Suspected operations include:
		# - klipper restart
		# - BEACON_AUTO_CALIBRATE
		bad_samples = 0
		good_samples = 0

		def cb(s):
			nonlocal good_samples, bad_samples
			dist = s["dist"]
			if dist is None or np.isinf(dist) or np.isnan(dist):
				bad_samples += 1
			else:
				good_samples += 1

		with self.beacon.streaming_session(cb):
			# Wait up to 5 seconds for 1000 good samples to be collected
			# This is a bit arbitrary, but it should be enough to ensure the beacon is ready.
			start_time = eventtime = self.reactor.monotonic()
			while good_samples < 1000 and (eventtime - start_time) < 5:
				eventtime = self.reactor.pause(eventtime + 0.1)

		logging.info(f"{self.name}: Prepared for sampling, collected {good_samples} good samples and {bad_samples} bad samples (total {good_samples+bad_samples} samples).")

		if good_samples < 1000:
			raise self.printer.command_error(f"Failed to prepare beacon for sampling, timed out waiting for good samples. Beacon must be calibrated and positioned correctly before running this command.")

	def parse_duples_string(s: str) -> tuple:
		"""
		Parses a string of duples and returns a tuple of tuple of ints.

		The function expects a string in the format:
			"(num, num), (num, num), ... "

		It raises a ValueError if the string doesn't match the expected pattern.

		Examples:
			"(20, 30),(  1, 99 ) , (100, 234)" -> ((20, 30), (1, 99), (100, 234))
		"""
		# Define a regex that must match the entire string.
		full_pattern = r'^\s*\(\s*\d+\s*,\s*\d+\s*\)(?:\s*,\s*\(\s*\d+\s*,\s*\d+\s*\))*\s*$'
		if not re.fullmatch(full_pattern, s):
			raise ValueError("Input string does not match the expected pattern.")

		# Define a pattern to find each tuple of digits.
		tuple_pattern = r'\(\s*(\d+)\s*,\s*(\d+)\s*\)'
		matches = re.findall(tuple_pattern, s)

		# Convert the string numbers to integers and pack them into tuples.
		return tuple((int(x), int(y)) for x, y in matches)

	def _check_trend_projection(self, moving_average_history, moving_average_history_times, trend_fit_window, trend_projection, threshold):
		if len(moving_average_history) < trend_fit_window:
			# Not enough data to fit a trend
			return False

		# Fit window 200 take about 1.5ms on Pi 4B, so for now we work on the assumption that
		# processing can take place in the main thread without blocking the reactor for too long.
		# If we need longer fit windows, we may need to move this to a separate process.

		# Keep track of time taken, warn if we risk timer too close error.
		start_time = self.reactor.monotonic()

		times = np.array(moving_average_history_times[-trend_fit_window:])
		values = np.array(moving_average_history[-trend_fit_window:])

		# Fit a linear regression to the last `trend_fit_window` samples
		slope, intercept = np.polyfit(times, values, 1)

		check_time = times[-1] + trend_projection
		check_value = slope * check_time + intercept

		time_taken = self.reactor.monotonic() - start_time

		if time_taken > 3.0:
			logging.warning(f"{self.name}: Trend projection check for fit window size {trend_fit_window} took {1000.*time_taken:.3f} ms, which risks causing a Klipper timer too close error. Consider reducing the trend fit window size.")

		self.reactor.pause(self.reactor.NOW)

		return abs(check_value) <= threshold

	desc_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK = "Wait for printer to reach thermal stability using Beacon to monitor deflection changes"
	def cmd_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK(self, gcmd):
		if self.beacon is None:
			raise self.printer.command_error("Beacon is not available. Please ensure RatOS is configured correctly.")

		if self.beacon.model is None:
			raise self.printer.command_error("Beacon model is not set. Calibrate the Beacon before running this command.")

		self._prepare_for_sampling()

		threshold = gcmd.get_int('THRESHOLD', self.def_threshold, minval=10)
		target_hold_count = gcmd.get_int('HOLD_COUNT', self.def_hold_count, minval=1)
		maximum_wait = gcmd.get_int('MAXIMUM_WAIT', self.def_maximum_wait, minval=0)
		# TODO: Hard-coded for now, make configurable later
		trend_checks = ((75, 675), (200, 675))

		moving_average_size = 150
		hold_count = 0

		# z_rate_history is a circular buffer of the last `moving_average_size` z-rates
		z_rate_history = [0] * moving_average_size
		z_rate_count = 0

		# moving_average_history grows as we collect more data. The full history is logged at the end of the wait.
		moving_average_history = []
		moving_average_history_times = []

		gcmd.respond_info(f"Waiting up to {self._format_seconds(maximum_wait)} for printer to reach thermal stability. Please wait...")

		start_time = self.reactor.monotonic()

		z_rate_session = BeaconZRateSession(self.config, self.beacon)

		ts = time.strftime("%Y%m%d_%H%M%S")
		fn = f"/tmp/heat_soak_{ts}.csv"

		logging.info(f"{self.name}: starting: threshold={threshold}, hold_count={target_hold_count}, max_wait={maximum_wait}, mas={moving_average_size}, trend_checks={trend_checks}, z_rates_file={fn}")

		with open(fn, "w") as z_rates_file:
			z_rates_file.write("time,z_rate\n")
			time_zero = None

			while True:
				if self.reactor.monotonic() - start_time > maximum_wait:
					gcmd.respond_info(f"Maximum wait time of {self._format_seconds(maximum_wait)} exceeded, wait completed.")
					return

				# Get the Z rate from the beacon
				try:
					z_rate_result = z_rate_session.get_next_z_rate()
				except Exception as e:
					raise self.printer.command_error(f"Error calculating Z-rate, wait ended prematurely: {e}")

				if time_zero is None:
					time_zero = z_rate_result[0]

				z_rates_file.write(f"{z_rate_result[0] - time_zero:.8e},{z_rate_result[1]:.8e}\n")

				z_rate_history[z_rate_count % moving_average_size] = z_rate_result[1]
				z_rate_count += 1

				moving_average = None

				if z_rate_count >= moving_average_size:
					moving_average = np.mean(z_rate_history)
					moving_average_history.append(moving_average)
					moving_average_history_times.append(z_rate_result[0])

				if moving_average is not None:
					elapsed = self.reactor.monotonic() - start_time

					# Log on every 15th z-rate to avoid flooding the console
					should_log = z_rate_count % 15 == 0

					if abs(moving_average) <= threshold:
						hold_count += 1
						msg = f"Z-rate {moving_average:.1f} nm/s, within threshold of {threshold} nm/s for {hold_count}/{target_hold_count} consecutive measurements"
					else:
						if hold_count > 0:
							msg = f"Z-rate {moving_average:.1f} nm/s, moved outside threshold of {threshold} nm/s after {hold_count} consecutive measurements"
							hold_count = 0
						else:
							msg = f"Z-rate {moving_average:.1f} nm/s, not within threshold of {threshold} nm/s"

					if hold_count >= target_hold_count:
						# For increased robustness, we perform one or more linear trend checks. Typically this will
						# include a trend fitted to a short history window, and a trend fitted to a longer history window.
						# Together, these checks ensure that the Z-rate is not only stable but also not trending towards instability.
						all_checks_passed = all(
							self._check_trend_projection(
								moving_average_history, moving_average_history_times,
								trend_check[0], trend_check[1], threshold
							) for trend_check in trend_checks)

						if all_checks_passed:
							gcmd.respond_info(f"Printer is considered thermally stable after {self._format_seconds(elapsed)}, wait completed.")
							return
						elif should_log:
							gcmd.respond_info(msg + f", waiting for trend checks to pass ({self._format_seconds(elapsed)} elapsed)")
					elif should_log:
						gcmd.respond_info(msg + f" ({self._format_seconds(elapsed)} elapsed)")

	desc_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_Z_RATES = "For developer use only. This command is used to run diagnostics for Beacon adaptive heat soak."
	def cmd_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_Z_RATES(self, gcmd):
		if self.beacon is None:
			raise self.printer.command_error("Beacon is not available. Please ensure RatOS is configured correctly.")

		if self.beacon.model is None:
			raise self.printer.command_error("Beacon model is not set. Calibrate the Beacon before running this command.")

		self._prepare_for_sampling()

		duration = gcmd.get_int('DURATION', 7200, minval=0)
		timestamp = time.strftime("%Y%m%d_%H%M%S")
		filename = gcmd.get('FILENAME', 'beacon_adaptive_heat_soak_z_rates') + f"_V2_{timestamp}.csv"

		fullpath = f'/home/pi/printer_data/config/{filename}'

		with open(fullpath, 'w') as f:
			f.write("time,z_rate\n")
			gcmd.respond_info(f'Capturing diagnostic Z-rates for {duration} seconds using V2 Z-rate calculation to file {fullpath}, please wait...')
			start_time = self.reactor.monotonic()
			z_rate_session = BeaconZRateSession(self.config, self.beacon)
			time_zero = None

			while self.reactor.monotonic() - start_time < duration:
				# Get the Z rate from the beacon
				try:
					z_rate_result = z_rate_session.get_next_z_rate()
				except Exception as e:
					raise self.printer.command_error(f"Error calculating Z-rate: {e}")

				gcmd.respond_info(f"Z-rate {z_rate_result[1]:.3f} nm/s")

				if time_zero is None:
					time_zero = z_rate_result[0]

				f.write(f"{z_rate_result[0] - time_zero:.8e},{z_rate_result[1]:.8e}\n")

			gcmd.respond_info(f'Diagnostic data captured to {fullpath}')

	desc_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_BEACON_SAMPLES = "For developer use only. This command is used to run diagnostics for Beacon adaptive heat soak."
	def cmd_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_BEACON_SAMPLES(self, gcmd):
		if self.beacon is None:
			raise self.printer.command_error("Beacon is not available. Please ensure RatOS is configured correctly.")

		if self.beacon.model is None:
			raise self.printer.command_error("Beacon model is not set. Calibrate the Beacon before running this command.")

		self._prepare_for_sampling()

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

	def _format_seconds(self, seconds):
		seconds = int(seconds)
		hours = seconds // 3600
		minutes = (seconds % 3600) // 60
		secs = seconds % 60
		
		if hours > 0:
			if minutes > 0 or secs > 0:
				if secs > 0:
					return f"{hours}h {minutes}m {secs}s"
				return f"{hours}h {minutes}m"
			return f"{hours}h"
		elif minutes > 0:
			if secs > 0:
				return f"{minutes}m {secs}s"
			return f"{minutes}m"
		else:
			return f"{secs}s"

def load_config(config):
	return BeaconAdaptiveHeatSoak(config)