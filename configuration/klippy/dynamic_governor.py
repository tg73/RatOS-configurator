# Automatically switches the CPU frequency governor to “performance”
# when any stepper is enabled, and back to “ondemand” when all steppers
# are disabled or Klipper is shutting down.
#
# Note: 
# 
# Requires the cpufrequtils package to be installed and the cpufreq-set
# command to be sudo-whitelisted for the user running Klipper.
#
# The current implentation assumes that the hardware does not support
# per-cpu frequency governors, so it sets the governor for all CPUs.
#
# Copyright (C) 2025 Tom Glastonbury <t@tg73.net>
#
# This file may be distributed under the terms of the GNU GPLv3 license.

import subprocess
import logging

class DynamicGovernor:
	def __init__(self, config):
		self.printer = config.get_printer()
		self.name = config.get_name()

		# config
		if not config.getboolean('enabled', True):
			logging.info(f"{self.name}: disabled by config")
			return

		self.governor_motors_on = config.get('governor_motors_on', 'performance')
		self.governor_motors_off = config.get('governor_motors_off', 'ondemand')

		# Ensure cpufreq-set is available and get the list of valid governors
		self._check_cpufrequtils()

		if self.governor_motors_on not in self._valid_governors:
			raise self.printer.config_error(
				f"{self.name}: governor_motors_on '{self.governor_motors_on}' "
				"not in available governors: "
				+ ', '.join(self._valid_governors)
			)

		if self.governor_motors_off not in self._valid_governors:
			raise self.printer.config_error(
				f"{self.name}: governor_motors_off '{self.governor_motors_off}' "
				"not in available governors: "
				+ ', '.join(self._valid_governors)
			)

		logging.info(f"{self.name}: governor_motors_on={self.governor_motors_on}, "
		             f"governor_motors_off={self.governor_motors_off}")

		# Track how many steppers are currently enabled
		self._enabled_count = 0

		# Register stepper enable state callbacks once Klipper is ready
		self.printer.register_event_handler('klippy:ready', self._on_ready)

		# Ensure we reset to ondemand on shutdown
		self.printer.register_event_handler('klippy:shutdown', self._on_shutdown)

	def _check_cpufrequtils(self):
		# Ensure cpufreq-set is available
		try:
			self._run_subprocess_with_timeout(['sudo', '-n', 'cpufreq-set', '--help'])
			logging.info(f"{self.name}: cpufreq-set is available")
		except FileNotFoundError:
			raise self.printer.config_error(
				f"{self.name}: cpufreq-set command not found. "
				"Please install the cpufrequtils package and ensure it is in the PATH."
			)
		except subprocess.CalledProcessError as e:
			raise self.printer.config_error(
				f"{self.name}: cpufreq-set command failed: {e}. "
				"Please ensure cpufrequtils is installed correctly."
			)
		except Exception as e:
			raise self.printer.config_error(
				f"{self.name}: Unexpected error checking cpufreq-set: {e}. "
				"Please ensure cpufrequtils is installed correctly."
			)

		# Obtain the list of valid governors
		try:
			output = self._run_subprocess_with_output(['cpufreq-info', '-g'], text=True)
			# Parse the output to get the list of governors
			# cpufreq-info -g returns a space-separated list of governors
			# If it returns a single item, it might be comma-separated
			# so we handle both cases.
			output = output.strip()
			self._valid_governors = output.split()
			if len(self._valid_governors) == 1:
				# If there's only one item, it might be comma-separated
				self._valid_governors = output.split(',')

			# Clean up any whitespace in the results
			self._valid_governors = [g.strip() for g in self._valid_governors if g.strip()]
			logging.info(f"{self.name}: available CPU governors: {', '.join(self._valid_governors)}")
		except FileNotFoundError:
			raise self.printer.config_error(
				f"{self.name}: cpufreq-info command not found. "
				"Please install the cpufrequtils package and ensure it is in the PATH."
			)
		except subprocess.CalledProcessError as e:
			raise self.printer.config_error(
				f"{self.name}: cpufreq-info command failed: {e}. "
				"Please ensure cpufrequtils is installed correctly."
			)
		except Exception as e:
			raise self.printer.config_error(
				f"{self.name}: Unexpected error checking cpufreq-info: {e}. "
				"Please ensure cpufrequtils is installed correctly."
			)

	def _on_ready(self):
		# Lookup the stepper_enable object and register callbacks
		stepper_enable = self.printer.lookup_object('stepper_enable')
		for stepper_id in stepper_enable.get_steppers():
			se = stepper_enable.lookup_enable(stepper_id)
			# If the stepper is already enabled, increment the count
			if se.is_enabled:
				self._enabled_count += 1
			# Register the state callback for this stepper
			se.register_state_callback(self._on_stepper_state)

		# Apply the initial governor based on current state		
		self._exec_cpufreq(self.governor_motors_on if self._enabled_count > 0 else self.governor_motors_off)

	def _exec_cpufreq(self, governor: str):
		"""Run cpufreq-set -r -g <governor> quietly."""
		try:
			self._run_subprocess_with_timeout(['sudo', '-n', 'cpufreq-set', '-r', '-g', governor])
			logging.info(f"{self.name}: set CPU governor to '{governor}'")
		except Exception as e:
			logging.warning(
				f"{self.name}: failed to set governor to '{governor}': {e}"
			)

	def _on_stepper_state(self, print_time, enabled: bool):
		"""
		Called whenever a stepper’s enable-pin state changes.
		enabled=True  → a stepper was turned on
		enabled=False → a stepper was turned off
		"""
		if enabled:
			# If transitioning from 0→1 enabled steppers, ramp to performance
			if self._enabled_count == 0:
				self._exec_cpufreq(self.governor_motors_on)
			self._enabled_count += 1
		else:
			# Guard against negative counts
			if self._enabled_count > 0:
				self._enabled_count -= 1
			# If no more steppers are enabled, switch back to ondemand
			if self._enabled_count == 0:
				self._exec_cpufreq(self.governor_motors_off)

		logging.debug(
			f"{self.name}: stepper state changed, enabled_count={self._enabled_count}"
		)

	def _on_shutdown(self):
		"""Reset governor when Klipper is shutting down or restarting."""
		# Regardless of current state, go back to ondemand
		self._exec_cpufreq(self.governor_motors_off)

	def _run_subprocess_with_timeout(self, cmd, timeout_secs=10):
		"""Run a subprocess command with a timeout.
		Raises subprocess.TimeoutExpired if the command does not complete
		within the specified timeout.
		"""
		reactor = self.printer.get_reactor()
		process = subprocess.Popen(
			cmd,
			stdout=subprocess.DEVNULL,
			stderr=subprocess.DEVNULL
		)
		eventtime = reactor.monotonic()
		# Poll for completion but don't block indefinitely
		for _ in range(int(timeout_secs * 10)):  # Try for specified seconds
			if process.poll() is not None:
				break
			eventtime = reactor.pause(eventtime + 0.1)

		if process.returncode is None:
			# Still running after timeout, kill it
			process.terminate()
			raise subprocess.TimeoutExpired(cmd, timeout_secs)

		if process.returncode != 0:
			raise subprocess.CalledProcessError(process.returncode, cmd)

	def _run_subprocess_with_output(self, cmd, timeout_secs=10, text=False):
		"""Run a subprocess command and return its output.
		Similar to subprocess.check_output but with a non-blocking timeout.
		Returns command output as bytes (or string if text=True).
		Raises subprocess.TimeoutExpired if the command does not complete
		within the specified timeout.
		"""
		reactor = self.printer.get_reactor()
		process = subprocess.Popen(
			cmd,
			stdout=subprocess.PIPE,
			stderr=subprocess.PIPE,
			text=text
		)
		eventtime = reactor.monotonic()
		# Poll for completion but don't block indefinitely
		for _ in range(int(timeout_secs * 10)):  # Try for specified seconds
			if process.poll() is not None:
				break
			eventtime = reactor.pause(eventtime + 0.1)

		if process.returncode is None:
			# Still running after timeout, kill it
			process.terminate()
			raise subprocess.TimeoutExpired(cmd, timeout_secs)

		if process.returncode != 0:
			raise subprocess.CalledProcessError(process.returncode, cmd, process.stdout.read())

		return process.stdout.read()

def load_config(config):
	return DynamicGovernor(config)
