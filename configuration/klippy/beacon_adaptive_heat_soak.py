# Adaptive heat soak with thermal stability detection using Beacon proximity sensor data
#
# Copyright (C) 2025 Tom Glastonbury <t@tg73.net>
#
# This file may be distributed under the terms of the GNU GPLv3 license.

import time, struct, logging
import numpy as np
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
		samples = None
		try:
			samples = memoryview(self._shm.buf).cast('d')
			out_of_range_count = 0
			i = 0

			def cb(s):
				nonlocal i, samples, out_of_range_count
				if i < sample_count:
					# s["dist"] is the smoothed distance, we want the unsmoothed data as this is
					# cleaner for rate calculations.
					time = s["time"]
					temp = s["temp"]
					data = s["data"]
					freq = self.beacon.count_to_freq(data)
					dist = self.beacon.freq_to_dist(freq, temp)
					if dist is None or np.isinf(dist) or np.isnan(dist):
						out_of_range_count += 1
					else:
						samples[i] = time
						samples[sample_count + i] = dist
						i += 1
					
			with self.beacon.streaming_session(cb):
				eventtime = self.reactor.monotonic()
				while i < sample_count:
					eventtime = self.reactor.pause(eventtime + 0.1)
					if out_of_range_count > 0:
						# fail fast, most likely a command was called before the beacon was calibrated or positioned correctly
						raise Exception(f"Beacon could not measure a valid distance. Beacon must be calibrated and positioned correctly before running this command.")	
			
			mid_time = (samples[0] + samples[sample_count - 1]) / 2

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
				raise Exception(result)
			else:
				return (mid_time, result)
		finally:
			if samples is not None:
				samples.release()
				del samples
	
	@staticmethod
	def _calculate_z_rate(conn, shm_name, sample_count):
		try:
			shm = None
			samples = None
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
				if samples is not None:
					samples.release()
					del samples
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

		# The default z-rate threshold in nm/s below which we consider the printer to be thermally stable.
		self.def_threshold = config.getint('threshold', 15, minval=10)

		# The default number of consecutive z-rate reaidings below the threshold before we consider the
		# printer to be thermally stable. This is used to avoid false positives due to noise in the data.
		self.def_hold_count = config.getint('hold_count', 3, minval=1)

		# The default maximum wait time in seconds for the printer to reach thermal stability.
		self.def_maximum_wait = config.getint('maximum_wait', 5400, minval=0)

		# The default number of samples to take per z-rate calculation. This value is only configurable 
		# to support testing and debugging, and should not be changed in production.
		self.def_samples_per_measurement = config.getint('samples_per_measurement', 30000, minval=30000)

		# Setup
		self.reactor = None
		self.beacon = None
		self.first_run = True

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
					
	desc_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK = "Wait for printer to reach thermal stability using Beacon to monitor deflection changes"
	def cmd_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK(self, gcmd):
		if self.beacon is None:
			raise self.printer.command_error("Beacon is not available. Please ensure RatOS is configured correctly.")

		self._handle_first_run()

		threshold = gcmd.get_float('THRESHOLD', self.def_threshold, minval=10)
		target_hold_count = gcmd.get_int('HOLD_COUNT', self.def_hold_count, minval=1)
		maximum_wait = gcmd.get_int('MAXIMUM_WAIT', self.def_maximum_wait, minval=0)
		samples_per_measurement = gcmd.get_int('SAMPLES_PER_MEASUREMENT', self.def_samples_per_measurement, minval=30000)

		moving_average_size = 5
		hold_count = 0
		history = []
		z_rate_session = None
		
		logging.info(f"{self.name}: Starting heat soak with threshold {threshold} nm/s, hold count {target_hold_count}, maximum wait {maximum_wait} seconds, {samples_per_measurement} samples per measurement and moving average size {moving_average_size}")
		gcmd.respond_info(f"Waiting for printer to reach thermal stability for up to {maximum_wait} seconds, requiring {target_hold_count} consecutive measurements within the Z-rate threshold of {threshold} nm/s. Please wait...")
		
		start_time = self.reactor.monotonic()
		
		try:
			z_rate_session = BeaconZRateSession(self.config, self.beacon, self.reactor)
			
			while True:
				if self.reactor.monotonic() - start_time > maximum_wait:
					gcmd.respond_info(f"Maximum wait time of {maximum_wait} seconds exceeded, exiting.")
					return

				# Get the Z rate from the beacon
				try:
					z_rate_result = z_rate_session.get_z_rate(samples_per_measurement)
				except Exception as e:
					logging.error(f"{self.name}: Error calculating Z-rate, wait aborted: {e}")
					raise self.printer.command_error(f"Error calculating Z-rate, wait ended prematurely: {e}")
				
				history.append(z_rate_result[1])

				if len(history) >= moving_average_size:
					moving_average = np.mean(history[-moving_average_size:])

					if abs(moving_average) <= threshold:
						hold_count += 1
						msg = f"Z-rate {moving_average:.1f} nm/s, within threshold of {threshold} nm/s for {hold_count}/{target_hold_count} consecutive measurements"						
					else:
						if hold_count > 0:							
							msg = f"Z-rate {moving_average:.1f} nm/s, moved outside threshold of {threshold} nm/s after {hold_count} consecutive measurements"
							hold_count = 0
						else:
							msg = f"Z-rate {moving_average:.1f} nm/s, not within threshold of {threshold} nm/s"
					
					gcmd.respond_info(msg)
					
					if hold_count >= target_hold_count:
						gcmd.respond_info(f"Printer is considered thermally stable after {hold_count} consecutive measurements within threshold of {threshold} nm/s.")
						for i in range(0, len(history), 20):
							chunk = history[i:i+20]
							logging.info(f"{self.name}: raw z-rates: {','.join(f'{v:.6e}' for v in chunk)}")
						return
				else:
					logging.info(f"{self.name}: Z-rate {z_rate_result[1]:.3f} nm/s, not enough samples for moving average yet")
		finally:
			if z_rate_session is not None:
				z_rate_session.cleanup()

	desc_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_Z_RATES = "For developer use only. This command is used to run diagnostics for Beacon adaptive heat soak."
	def cmd_BEACON_WAIT_FOR_PRINTER_HEAT_SOAK_CAPTURE_Z_RATES(self, gcmd):
		if self.beacon is None:
			raise self.printer.command_error("Beacon is not available. Please ensure RatOS is configured correctly.")

		self._handle_first_run()

		duration = gcmd.get_int('DURATION', 7200, minval=0)
		samples_per_measurement = gcmd.get_int('SAMPLES_PER_MEASUREMENT', 30000, minval=1000)

		timestamp = time.strftime("%Y%m%d_%H%M%S")
		filename = f'/home/pi/printer_data/config/beacon_adaptive_heat_soak_z_rates_{samples_per_measurement}_{timestamp}.txt'

		# Make sure we can open the file before starting capture
		with open(filename, 'w') as f:
			gcmd.respond_info(f'Capturing diagnostic Z-rates for {duration} seconds using {samples_per_measurement} samples per Z-rate calculation to file {filename}, please wait...')
			start_time = self.reactor.monotonic()
			z_rate_session = None
			try:
				z_rate_session = BeaconZRateSession(self.config, self.beacon, self.reactor)
				history = []
				time_zero = None
				while self.reactor.monotonic() - start_time < duration:
					# Get the Z rate from the beacon
					try:
						z_rate_result = z_rate_session.get_z_rate(samples_per_measurement)
					except Exception as e:
						raise self.printer.command_error(f"Error calculating Z-rate: {e}")

					gcmd.respond_info(f"Z-rate {z_rate_result[1]:.3f} nm/s")

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