/** @vitest-environment jsdom */
import React, { Suspense } from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { RecoilRoot, useRecoilValue, useSetRecoilState } from 'recoil';
import { renderHook, waitFor } from '@testing-library/react';
import {
	HotendsQuery,
	ExtrudersQuery,
	ProbesQuery,
	ThermistorsQuery,
	CompatibleXEndstopsQuery,
	CompatibleYEndstopsQuery,
	CompatiblePartFansQuery,
	CompatibleHotendFansQuery,
	CompatibleXAccelerometersQuery,
	CompatibleYAccelerometersQuery,
	CompatibleFilamentSensorsQuery,
	CompatibleControllerFansQuery,
	CompatibleChamberLightingQuery,
	CompatibleToolheadAlignmentSystemQuery,
	CompatibleChamberAirFilterQuery,
	extractToolNumber,
} from '@/recoil/hardware-options';
import { ControlboardState } from '@/recoil/printer';
import { PrinterToolheadState } from '@/recoil/toolhead';
import { trpcClient } from '@/helpers/trpc';
import { PrinterAxis } from '@/zods/motion';
import { Board } from '@/zods/boards';

// Mock the trpcClient
vi.mock('@/helpers/trpc', () => ({
	trpcClient: {
		printer: {
			hotends: { query: vi.fn() },
			extruders: { query: vi.fn() },
			probes: { query: vi.fn() },
			thermistors: { query: vi.fn() },
			xEndstops: { query: vi.fn() },
			yEndstops: { query: vi.fn() },
			partFanOptions: { query: vi.fn() },
			hotendFanOptions: { query: vi.fn() },
			xAccelerometerOptions: { query: vi.fn() },
			yAccelerometerOptions: { query: vi.fn() },
			filamentSensorOptions: { query: vi.fn() },
			controllerFanOptions: { query: vi.fn() },
			chamberLightingOptions: { query: vi.fn() },
			toolheadAlignmentSystemOptions: { query: vi.fn() },
			chamberAirFilterOptions: { query: vi.fn() },
		},
	},
}));

// Mock the logger
vi.mock('@/app/_helpers/logger', () => ({
	getLogger: () => ({
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	}),
}));

describe('Hardware Options Selectors', () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.resetAllMocks();
	});

	describe('extractToolNumber', () => {
		it('extracts tool 0 from number', () => {
			expect(extractToolNumber(0)).toBe(0);
		});

		it('extracts tool 1 from number', () => {
			expect(extractToolNumber(1)).toBe(1);
		});

		it('extracts tool 0 from PrinterAxis.x', () => {
			expect(extractToolNumber(PrinterAxis.x)).toBe(0);
		});

		it('extracts tool 0 from PrinterAxis.extruder', () => {
			expect(extractToolNumber(PrinterAxis.extruder)).toBe(0);
		});

		it('extracts tool 1 from PrinterAxis.dual_carriage', () => {
			expect(extractToolNumber(PrinterAxis.dual_carriage)).toBe(1);
		});

		it('extracts tool 1 from PrinterAxis.extruder1', () => {
			expect(extractToolNumber(PrinterAxis.extruder1)).toBe(1);
		});
	});

	describe('HotendsQuery', () => {
		it('fetches hotends successfully', async () => {
			const mockHotends = [
				{ id: 'rapido-plus-uhf', title: 'Rapido Plus UHF', thermistor: 'PT1000' },
				{ id: 'dragon-uhf', title: 'Dragon UHF', thermistor: 'ATC Semitec 104GT-2' },
			];

			vi.mocked(trpcClient.printer.hotends.query).mockResolvedValue(mockHotends as any);

			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(HotendsQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual(mockHotends);
			});
		});
	});

	describe('ExtrudersQuery', () => {
		it('fetches extruders successfully', async () => {
			const mockExtruders = [
				{ id: 'lgx-lite', title: 'LGX Lite' },
				{ id: 'orbiter-v2', title: 'Orbiter V2' },
			];

			vi.mocked(trpcClient.printer.extruders.query).mockResolvedValue(mockExtruders as any);

			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(ExtrudersQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual(mockExtruders);
			});
		});
	});

	describe('ProbesQuery', () => {
		it('fetches probes successfully', async () => {
			const mockProbes = [
				{ id: 'bltouch', title: 'BLTouch' },
				{ id: 'beacon', title: 'Beacon' },
			];

			vi.mocked(trpcClient.printer.probes.query).mockResolvedValue(mockProbes as any);

			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(ProbesQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual(mockProbes);
			});
		});
	});

	describe('ThermistorsQuery', () => {
		it('fetches thermistors successfully', async () => {
			const mockThermistors = [
				{ id: 'PT1000', title: 'PT1000' },
				{ id: 'ATC Semitec 104GT-2', title: 'ATC Semitec 104GT-2' },
			];

			vi.mocked(trpcClient.printer.thermistors.query).mockResolvedValue(mockThermistors as any);

			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(ThermistorsQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual(mockThermistors);
			});
		});
	});

	describe('CompatibleXEndstopsQuery', () => {
		it('fetches X endstops when controlboard is set', async () => {
			const mockEndstops = [
				{ id: 'endstop-controlboard', title: 'Endstop on Controlboard' },
				{ id: 'endstop-toolboard', title: 'Endstop on Toolboard' },
			];

			vi.mocked(trpcClient.printer.xEndstops.query).mockResolvedValue(mockEndstops as any);

			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot
					initializeState={({ set }) => {
						set(ControlboardState, { id: 'btt-octopus-11' } as Board);
					}}
				>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(CompatibleXEndstopsQuery(0)), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual(mockEndstops);
			});

			expect(trpcClient.printer.xEndstops.query).toHaveBeenCalledWith({
				config: { controlboard: 'btt-octopus-11' },
				toolOrAxis: 0,
			});
		});

		it('returns empty array when controlboard is not set', async () => {
			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(CompatibleXEndstopsQuery(0)), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual([]);
			});

			expect(trpcClient.printer.xEndstops.query).not.toHaveBeenCalled();
		});

		it('returns empty array on error', async () => {
			vi.mocked(trpcClient.printer.xEndstops.query).mockRejectedValueOnce(new Error('Network error'));

			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot
					initializeState={({ set }) => {
						set(ControlboardState, { id: 'btt-octopus-11' } as Board);
					}}
				>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(CompatibleXEndstopsQuery(0)), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual([]);
			});
		});
	});

	describe('CompatibleControllerFansQuery', () => {
		it('fetches controller fans when controlboard is set', async () => {
			const mockFans = [
				{ id: '2pin', title: '2-pin Fan' },
				{ id: '4pin', title: '4-pin Fan' },
				{ id: 'none', title: 'None' },
			];

			vi.mocked(trpcClient.printer.controllerFanOptions.query).mockResolvedValueOnce(mockFans as any);

			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot
					initializeState={({ set }) => {
						set(ControlboardState, { id: 'btt-octopus-11' } as Board);
					}}
				>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(CompatibleControllerFansQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual(mockFans);
			});

			expect(trpcClient.printer.controllerFanOptions.query).toHaveBeenCalledWith({
				config: { controlboard: 'btt-octopus-11' },
			});
		});

		it('returns empty array when controlboard is not set', async () => {
			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(CompatibleControllerFansQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual([]);
			});

			expect(trpcClient.printer.controllerFanOptions.query).not.toHaveBeenCalled();
		});

		it('returns empty array on error', async () => {
			vi.mocked(trpcClient.printer.controllerFanOptions.query).mockRejectedValueOnce(new Error('Network error'));

			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot
					initializeState={({ set }) => {
						set(ControlboardState, { id: 'btt-octopus-11' } as Board);
					}}
				>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(CompatibleControllerFansQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual([]);
			});
		});
	});

	describe('CompatibleChamberLightingQuery', () => {
		it('fetches chamber lighting options when controlboard is set', async () => {
			const mockOptions = [
				{ id: 'neopixel', title: 'Neopixel LED Strip' },
				{ id: 'none', title: 'None' },
			];

			vi.mocked(trpcClient.printer.chamberLightingOptions.query).mockResolvedValue(mockOptions as any);

			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot
					initializeState={({ set }) => {
						set(ControlboardState, { id: 'btt-octopus-11' } as Board);
					}}
				>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(CompatibleChamberLightingQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual(mockOptions);
			});

			expect(trpcClient.printer.chamberLightingOptions.query).toHaveBeenCalledWith({
				config: { controlboard: 'btt-octopus-11' },
			});
		});

		it('returns empty array when controlboard is not set', async () => {
			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(CompatibleChamberLightingQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual([]);
			});

			expect(trpcClient.printer.chamberLightingOptions.query).not.toHaveBeenCalled();
		});
	});

	describe('CompatibleToolheadAlignmentSystemQuery', () => {
		it('fetches toolhead alignment systems when controlboard is set', async () => {
			const mockOptions = [
				{ id: 'z-tilt', title: 'Z-Tilt' },
				{ id: 'quad-gantry-level', title: 'Quad Gantry Level' },
			];

			vi.mocked(trpcClient.printer.toolheadAlignmentSystemOptions.query).mockResolvedValue(mockOptions as any);

			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot
					initializeState={({ set }) => {
						set(ControlboardState, { id: 'btt-octopus-11' } as Board);
					}}
				>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(CompatibleToolheadAlignmentSystemQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual(mockOptions);
			});

			expect(trpcClient.printer.toolheadAlignmentSystemOptions.query).toHaveBeenCalledWith({
				config: { controlboard: 'btt-octopus-11' },
			});
		});

		it('returns empty array when controlboard is not set', async () => {
			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(CompatibleToolheadAlignmentSystemQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual([]);
			});

			expect(trpcClient.printer.toolheadAlignmentSystemOptions.query).not.toHaveBeenCalled();
		});
	});

	describe('CompatibleChamberAirFilterQuery', () => {
		it('fetches chamber air filter options when controlboard is set', async () => {
			const mockOptions = [
				{ id: 'nevermore', title: 'Nevermore Filter' },
				{ id: 'none', title: 'None' },
			];

			vi.mocked(trpcClient.printer.chamberAirFilterOptions.query).mockResolvedValue(mockOptions as any);

			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot
					initializeState={({ set }) => {
						set(ControlboardState, { id: 'btt-octopus-11' } as Board);
					}}
				>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(CompatibleChamberAirFilterQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual(mockOptions);
			});

			expect(trpcClient.printer.chamberAirFilterOptions.query).toHaveBeenCalledWith({
				config: { controlboard: 'btt-octopus-11' },
			});
		});

		it('returns empty array when controlboard is not set', async () => {
			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<RecoilRoot>
					<Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
				</RecoilRoot>
			);

			const { result } = renderHook(() => useRecoilValue(CompatibleChamberAirFilterQuery), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current).toEqual([]);
			});

			expect(trpcClient.printer.chamberAirFilterOptions.query).not.toHaveBeenCalled();
		});
	});
});
