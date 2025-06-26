# Exposes an immutable snapshot of the printer's configuration status from initialization time,
# with singleton-like copy semantics to avoid costly deep copies when accessing the status.
#
# Intended for use in macros accessing `printer.configfile`. Accessing `printer.configfile`
# causes a deep copy of the configuration status, which can be expensive, notably for
# large configurations, potentially leading to `timer too close` errors.
#
# Macros should instead access `printer.initconfigfile` to get the immutable status. Note that
# this status is a fixed snapshot from when Kipper initializes, so it will not reflect changes made
# to the configuration after Kipper initializes - for example, updated PID tuning results and
# bed mesh profile additions or removals.
#
# Copyright (C) 2025 Tom Glastonbury <t@tg73.net>
#
# This file may be distributed under the terms of the GNU GPLv3 license.

from collections.abc import Mapping
import copy

class ImmutablePrinterConfigStatusWrapper(Mapping):

	def __init__(self, config):
		self._printer = config.get_printer()
		self._printer.register_event_handler("klippy:connect",
											self._handle_connect)		

	def _handle_connect(self):
		pconfig = self._printer.lookup_object('configfile')
		eventtime = self._printer.get_reactor().monotonic()
		self._immutable_status = copy.deepcopy(pconfig.get_status(eventtime))
		self._immutable_status.pop('save_config_pending', None)
		self._immutable_status.pop('save_config_pending_items', None)
	
	def get_status(self, eventtime=None):
		return self
	
	def __deepcopy__(self, memo):
		if id(self) in memo:
			return memo[id(self)]
		
		memo[id(self)] = self
		return self
	
	def __copy__(self):
		return self
	
	def __getitem__(self, key):
		return self._immutable_status[key]

	def __contains__(self, key):
		return key in self._immutable_status

	def __iter__(self):
		return iter(self._immutable_status)

	def __len__(self):
		return len(self._immutable_status)
	
	def __repr__(self):
		return f"{self.__class__.__name__}({self._immutable_status!r})"
	
	def get(self, key, default=None):
		return self._immutable_status.get(key, default)

	def keys(self):
		return self._immutable_status.keys()

	def values(self):
		return self._immutable_status.values()

	def items(self):
		return self._immutable_status.items()

def load_config(config):
	return ImmutablePrinterConfigStatusWrapper(config)