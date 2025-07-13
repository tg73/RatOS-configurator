# RatOS G-code Redirect
#
# The primary purpose of this module is to enable RatOS [gcode_macro ...] overrides
# to be robust against accidental stomping by other G-code macros or plugins added
# by the user. At the same time, it allows the user to wrap the RatOS G-code
# overrides in their own G-code macros, which can be useful for debugging or
# extending the functionality of the RatOS G-code overrides.
#
# It is still possible for a determined user to intentionally override and replace a RatOS
# [gcode_macro ...] based override, but this is strictly not recommended and may result in
# unexpected behaviour that risks damaging the printer or causing other issues.
#
# [ratos_gcode_redirect ...] sections are intended for use only in the distributed
# RatOS configuration files, and should not be used in custom user configuration.
#
# Copyright (C) 2025 Tom Glastonbury <t@tg73.net>
#
# This file may be distributed under the terms of the GNU GPLv3 license.

import logging

class RatOSGcodeRedirect:
	def __init__(self, config):
		self.name = config.get_name()
		self.command = self.name.split()[-1]
		self.printer = config.get_printer()
		self.gcode = self.printer.lookup_object('gcode')
		is_traditional = self.gcode.is_traditional_gcode(self.command)
		
		self.prev_cmd = None

		# 45 = Danmark, 05 = "OS" :-)
		dot = '' if '.' in self.command else '.'
		default_redirect_to = f"{self.command}{dot}45051" if is_traditional else f"_RATOS_{self.command}"
		default_rename_existing = f"{self.command}{dot}45050" if is_traditional else f"_RATOS_{self.command}_ORIGINAL"
		
		self.redirect_to = config.get('redirect_to', default_redirect_to)
		self.rename_existing = config.get('rename_existing', default_rename_existing)
		self.require_existing = config.getboolean('require_existing', False)		

		if is_traditional != self.gcode.is_traditional_gcode(self.redirect_to):
			raise self.gcode.error(f"redirect_to name {self.redirect_to} must match the traditional/extended G-code style of {self.command}")
		
		if is_traditional != self.gcode.is_traditional_gcode(self.rename_existing):
			raise self.gcode.error(f"rename_existing name {self.rename_existing} must match the traditional/extended G-code style of {self.command}")

		# We look for the original command at connect time, which repsects config order. This requires that
		# the original command is registered before the connect handling of this redirect (or optionally not registered at all,
		# depending on require_existing).
		self.printer.register_event_handler("klippy:connect", self._handle_connect)

	def _handle_connect(self):
		try:
			self.prev_cmd = self.gcode.register_command(self.command, None)
			if self.prev_cmd is None and self.require_existing:
				raise self.printer.config_error(f"{self.name}: required existing {self.command} command not found")
						
			self.gcode.register_command(
				self.rename_existing, self._invoke_original, 
				f"(original {self.command} command, registered by {self.name})" if self.prev_cmd is not None else f"(empty stub for original {self.command} command which was not defined, registered by {self.name})")
			
			self.gcode.register_command(self.command, self._invoke_redirect)

			renamed_msg = "not found" if self.prev_cmd is None else f"renamed to {self.rename_existing}"
			logging.info(f"{self.name}: registered redirect for {self.command} to {self.redirect_to} with {'required' if self.require_existing else 'optional'} existing {renamed_msg}")
		except Exception as e:
			logging.error(f"{self.name}: failed to register redirect for {self.command} to {self.redirect_to} with {'required' if self.require_existing else 'optional'} existing renamed to {self.rename_existing}")
			raise
				
	def _invoke_redirect(self, gcmd):
		line = f"{self.redirect_to} {gcmd.get_raw_command_parameters()}"
		self.gcode.run_script_from_command(line)

	def _invoke_original(self, gcmd):
		if self.prev_cmd is not None:
			self.prev_cmd(gcmd)				

def load_config_prefix(config):
	return RatOSGcodeRedirect(config)