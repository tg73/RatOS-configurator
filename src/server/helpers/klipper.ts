import { getLogger } from '@/app/_helpers/logger';
import { getErrorMessage } from '@/utils/exception-handling';
import { MoonrakerPrinterState, MoonrakerPrinterStateErrorEnum, parseMoonrakerHTTPResponse } from '@/zods/moonraker';
import { get } from 'http';
import { ZodError } from 'zod';

export const queryPrinterState = async (): Promise<
	Zod.output<typeof MoonrakerPrinterState>['status']['print_stats']['state']
> => {
	try {
		const moonrakerRes = await fetch('http://localhost:7125/printer/objects/query?print_stats');
		if (moonrakerRes)
			return (await parseMoonrakerHTTPResponse(moonrakerRes, MoonrakerPrinterState)).result.status.print_stats.state;
	} catch (e) {
		if (
			e instanceof Error &&
			(e.cause === MoonrakerPrinterStateErrorEnum.MOONRAKER_OFFLINE ||
				e.cause === MoonrakerPrinterStateErrorEnum.MOONRAKER_INTERNAL_ERROR)
		) {
			return 'error';
		} else if (e instanceof ZodError) {
			return 'error';
		} else {
			throw e;
		}
	}
	return 'error';
};

export const klipperRestart = async (force = false) => {
	if (force) {
		getLogger().info('Restarting Klipper without checking printer state...');
	} else {
		let state: string | undefined;
		try {
			const state = await queryPrinterState();
		} catch (e) {
			getLogger().error(`Failed to query printer state before Klipper restart: ${getErrorMessage(e)}`);
			return false;
		}
		if (!['error', 'complete', 'canceled', 'standby', undefined].includes(state)) {
			getLogger().info(`Skipping Klipper restart because printer is in '${state}' state.`);
			return false;
		}
		getLogger().info(`Restarting Klipper, printer is currently in '${state}' state...`);
	}

	try {
		await fetch('http://localhost:7125/printer/restart', { method: 'POST' });
		getLogger().info('Klipper restart command sent successfully.');
		return true;
	} catch (e) {
		getLogger().error(`Failed to send Klipper restart command: ${getErrorMessage(e)}`);
	}

	return false;
};
