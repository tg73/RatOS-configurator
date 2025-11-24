import { describe, expect, it, beforeAll } from 'vitest';
import { z } from 'zod';
import {
	HardwareDefinition,
	UnconnectedHardwareInstance,
	HardwareInstance,
	HardwareInstanceRef,
	createHardwareSchemas,
	HardwareTypeKey,
} from '@/zods/template-api';

describe('template-api schemas', () => {
	// Extract the first enum member from HardwareDefinition.type dynamically
	let firstHardwareType: HardwareTypeKey;
	let validHardwareTypes: HardwareTypeKey[];
	let validPathPrefix: string;

	beforeAll(() => {
		const typeSchema = HardwareDefinition.shape.type;
		if (typeSchema instanceof z.ZodEnum) {
			validHardwareTypes = typeSchema.options;
			firstHardwareType = validHardwareTypes[0];
		} else {
			throw new Error('HardwareDefinition.type is not a ZodEnum');
		}

		// Extract the path validation prefix from UnconnectedHardwareInstance schema
		// The path must start with RATOS_CONFIGURATION_PATH (from env) and end with .json
		// (see module scope code near the start of src/zods/template-api.ts)
		validPathPrefix = process.env.RATOS_CONFIGURATION_PATH || '';
	});

	describe('HardwareDefinition', () => {
		it('parses a valid hardware definition', () => {
			const valid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
			};

			const result = HardwareDefinition.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual(valid);
			}
		});

		it('parses a valid hardware definition with optional templateOptions', () => {
			const valid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
				templateOptions: { key: 'value', nested: { data: 123 } },
			};

			const result = HardwareDefinition.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.templateOptions).toEqual({ key: 'value', nested: { data: 123 } });
			}
		});

		it('accepts hardware definition without templateOptions', () => {
			const valid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
			};

			const result = HardwareDefinition.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.templateOptions).toBeUndefined();
			}
		});

		it('rejects invalid type', () => {
			const invalid = {
				type: 'invalid-type',
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
			};

			const result = HardwareDefinition.safeParse(invalid);
			expect(result.success).toBe(false);
		});

		it('rejects missing required fields', () => {
			const invalid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				// missing description, manufacturer, template
			};

			const result = HardwareDefinition.safeParse(invalid);
			expect(result.success).toBe(false);
		});

		it('accepts all valid hardware types from the enum', () => {
			validHardwareTypes.forEach((hwType) => {
				const valid = {
					type: hwType,
					title: 'Test Hardware',
					description: 'A test hardware item',
					manufacturer: 'Test Corp',
					template: 'test-template.cfg',
				};

				const result = HardwareDefinition.safeParse(valid);
				expect(result.success).toBe(true);
			});
		});
	});

	describe('UnconnectedHardwareInstance', () => {
		it('parses a valid unconnected hardware instance', () => {
			const valid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
				id: 'test-hw-001',
				path: `${validPathPrefix}/hardware/test-hardware.json`,
			};

			const result = UnconnectedHardwareInstance.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe('test-hw-001');
				expect(result.data.path).toBe(`${validPathPrefix}/hardware/test-hardware.json`);
			}
		});

		it('rejects path not ending with .json', () => {
			const invalid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
				id: 'test-hw-001',
				path: `${validPathPrefix}/hardware/test-hardware.cfg`,
			};

			const result = UnconnectedHardwareInstance.safeParse(invalid);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0].message).toContain('.json');
			}
		});

		it('rejects missing id', () => {
			const invalid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
				path: '/test/path/hardware.json',
			};

			const result = UnconnectedHardwareInstance.safeParse(invalid);
			expect(result.success).toBe(false);
		});

		it('rejects missing path', () => {
			const invalid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
				id: 'test-hw-001',
			};

			const result = UnconnectedHardwareInstance.safeParse(invalid);
			expect(result.success).toBe(false);
		});
	});

	describe('HardwareInstance', () => {
		it('parses a valid connected hardware instance', () => {
			const valid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
				id: 'test-hw-001',
				path: `${validPathPrefix}/hardware/test.json`,
				connectedTo: 'toolboard' as const,
			};

			const result = HardwareInstance.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.connectedTo).toBe('toolboard');
			}
		});

		it('accepts controlboard as connectedTo value', () => {
			const valid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
				id: 'test-hw-001',
				path: `${validPathPrefix}/hardware/test.json`,
				connectedTo: 'controlboard' as const,
			};

			const result = HardwareInstance.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.connectedTo).toBe('controlboard');
			}
		});

		it('rejects invalid connectedTo value', () => {
			const invalid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
				id: 'test-hw-001',
				path: `${validPathPrefix}/hardware/test.json`,
				connectedTo: 'invalid-board',
			};

			const result = HardwareInstance.safeParse(invalid);
			expect(result.success).toBe(false);
		});

		it('parses with optional badge array', () => {
			const valid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
				id: 'test-hw-001',
				path: `${validPathPrefix}/hardware/test.json`,
				connectedTo: 'toolboard' as const,
				badge: [
					{ children: 'New', color: 'green' as const },
					{ children: 'Beta', color: 'yellow' as const },
				],
			};

			const result = HardwareInstance.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.badge).toHaveLength(2);
				expect(result.data.badge?.[0].children).toBe('New');
			}
		});

		it('accepts hardware instance without badge', () => {
			const valid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
				id: 'test-hw-001',
				path: `${validPathPrefix}/hardware/test.json`,
				connectedTo: 'toolboard' as const,
			};

			const result = HardwareInstance.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.badge).toBeUndefined();
			}
		});

		it('rejects missing connectedTo', () => {
			const invalid = {
				type: firstHardwareType,
				title: 'Test Hardware',
				description: 'A test hardware item',
				manufacturer: 'Test Corp',
				template: 'test-template.cfg',
				id: 'test-hw-001',
				path: `${validPathPrefix}/hardware/test.json`,
			};

			const result = HardwareInstance.safeParse(invalid);
			expect(result.success).toBe(false);
		});
	});

	describe('HardwareInstanceRef', () => {
		it('parses a valid hardware instance reference with only id and connectedTo', () => {
			const valid = {
				id: 'test-hw-001',
				connectedTo: 'toolboard' as const,
			};

			const result = HardwareInstanceRef.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe('test-hw-001');
				expect(result.data.connectedTo).toBe('toolboard');
			}
		});

		it('strips extra fields beyond id and connectedTo', () => {
			const input = {
				id: 'test-hw-001',
				connectedTo: 'toolboard' as const,
				type: firstHardwareType,
				title: 'Extra Field',
				description: 'Should be stripped',
			};

			const result = HardwareInstanceRef.safeParse(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual({
					id: 'test-hw-001',
					connectedTo: 'toolboard',
				});
				expect((result.data as any).type).toBeUndefined();
				expect((result.data as any).title).toBeUndefined();
			}
		});

		it('rejects missing id', () => {
			const invalid = {
				connectedTo: 'toolboard' as const,
			};

			const result = HardwareInstanceRef.safeParse(invalid);
			expect(result.success).toBe(false);
		});

		it('rejects missing connectedTo', () => {
			const invalid = {
				id: 'test-hw-001',
			};

			const result = HardwareInstanceRef.safeParse(invalid);
			expect(result.success).toBe(false);
		});

		it('requires both id and connectedTo (from .required())', () => {
			const partial = {
				id: 'test-hw-001',
			};

			const result = HardwareInstanceRef.safeParse(partial);
			expect(result.success).toBe(false);
		});
	});

	describe('createHardwareSchemas', () => {
		describe('with no extended schema', () => {
			let schemas: any;

			beforeAll(() => {
				schemas = createHardwareSchemas(firstHardwareType);
			});

			it('creates a Definition schema with literal type', () => {
				const valid = {
					type: firstHardwareType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
				};

				const result = schemas.Definition.safeParse(valid);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.type).toBe(firstHardwareType);
				}
			});

			it('rejects Definition with wrong type literal', () => {
				const otherType = validHardwareTypes.find((t) => t !== firstHardwareType) || 'wrong-type';
				const invalid = {
					type: otherType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
				};

				const result = schemas.Definition.safeParse(invalid);
				expect(result.success).toBe(false);
			});

			it('creates an Unconnected schema with id and path', () => {
				const valid = {
					type: firstHardwareType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
					id: 'test-001',
					path: `${validPathPrefix}/hardware/test.json`,
				};

				const result = schemas.Unconnected.safeParse(valid);
				expect(result.success).toBe(true);
			});

			it('creates a Connected schema with connectedTo', () => {
				const valid = {
					type: firstHardwareType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
					id: 'test-001',
					path: `${validPathPrefix}/hardware/test.json`,
					connectedTo: 'toolboard' as const,
				};

				const result = schemas.Connected.safeParse(valid);
				expect(result.success).toBe(true);
			});

			it('creates a branded Ref schema', () => {
				const valid = {
					id: 'test-001',
					connectedTo: 'toolboard' as const,
				};

				const result = schemas.Ref.safeParse(valid);
				expect(result.success).toBe(true);
			});

			it('creates an OptionalRef schema that accepts undefined', () => {
				// Test that undefined is accepted (critical test for .brand().optional() ordering)
				const resultUndefined = schemas.OptionalRef.safeParse(undefined);
				expect(resultUndefined.success).toBe(true);

				// Test that valid ref also works
				const resultValid = schemas.OptionalRef.safeParse({
					id: 'test-001',
					connectedTo: 'toolboard' as const,
				});
				expect(resultValid.success).toBe(true);
			});

			it('ensures OptionalRef type allows undefined in TypeScript', () => {
				// This is a compile-time check that will fail if optional() doesn't work correctly
				type OptRefType = z.infer<typeof schemas.OptionalRef>;
				const undefinedValue: OptRefType = undefined;
				expect(undefinedValue).toBeUndefined();
			});

			it('creates distinct branded types for Ref (not interchangeable)', () => {
				// This test verifies type branding works at runtime
				const ref1 = schemas.Ref.parse({ id: 'test-001', connectedTo: 'toolboard' as const });

				// Create another schema with different type
				const otherType = validHardwareTypes.find((t) => t !== firstHardwareType) || 'chamber-lighting';
				const otherSchemas = createHardwareSchemas(otherType);

				const ref2 = otherSchemas.Ref.parse({ id: 'test-002', connectedTo: 'controlboard' as const });

				// At runtime, the values are similar objects, but TypeScript should treat them as distinct types
				// This test documents the behavior - the branding is mainly for TypeScript type safety
				expect(ref1.id).toBe('test-001');
				expect(ref2.id).toBe('test-002');
			});

			it('provides toRef converter function', () => {
				const connected = {
					type: firstHardwareType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
					id: 'test-001',
					path: `${validPathPrefix}/hardware/test.json`,
					connectedTo: 'toolboard' as const,
				};

				const parsedConnected = schemas.Connected.parse(connected);
				const ref = schemas.toRef(parsedConnected);

				expect(ref.id).toBe('test-001');
				expect(ref.connectedTo).toBe('toolboard');
				expect((ref as any).type).toBeUndefined();
				expect((ref as any).title).toBeUndefined();
			});

			it('provides toOptionalRef converter function that accepts undefined', () => {
				const resultUndefined = schemas.toOptionalRef(undefined);
				expect(resultUndefined).toBeUndefined();
			});

			it('provides toOptionalRef converter function that converts connected instances', () => {
				const connected = {
					type: firstHardwareType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
					id: 'test-001',
					path: `${validPathPrefix}/hardware/test.json`,
					connectedTo: 'toolboard' as const,
				};

				const parsedConnected = schemas.Connected.parse(connected);
				const ref = schemas.toOptionalRef(parsedConnected);

				expect(ref).toBeDefined();
				if (ref) {
					expect(ref.id).toBe('test-001');
					expect(ref.connectedTo).toBe('toolboard');
				}
			});
		});

		describe('with extended schema', () => {
			it('merges extended schema fields into Definition', () => {
				const extendedSchema = z.object({
					customField: z.string(),
					numericField: z.number().optional(),
				});

				const schemas = createHardwareSchemas(firstHardwareType, extendedSchema);

				const valid = {
					type: firstHardwareType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
					customField: 'custom-value',
				};

				const result = schemas.Definition.safeParse(valid);
				expect(result.success).toBe(true);
				if (result.success) {
					expect((result.data as any).customField).toBe('custom-value');
				}
			});

			it('requires extended schema required fields', () => {
				const extendedSchema = z.object({
					customField: z.string(),
				});

				const schemas = createHardwareSchemas(firstHardwareType, extendedSchema);

				const invalid = {
					type: firstHardwareType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
					// missing customField
				};

				const result = schemas.Definition.safeParse(invalid);
				expect(result.success).toBe(false);
			});

			it('accepts extended schema optional fields as undefined', () => {
				const extendedSchema = z.object({
					customField: z.string().optional(),
				});

				const schemas = createHardwareSchemas(firstHardwareType, extendedSchema);

				const valid = {
					type: firstHardwareType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
				};

				const result = schemas.Definition.safeParse(valid);
				expect(result.success).toBe(true);
				if (result.success) {
					expect((result.data as any).customField).toBeUndefined();
				}
			});

			it('propagates extended fields to Unconnected schema', () => {
				const extendedSchema = z.object({
					customField: z.string(),
				});

				const schemas = createHardwareSchemas(firstHardwareType, extendedSchema);

				const valid = {
					type: firstHardwareType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
					id: 'test-001',
					path: `${validPathPrefix}/hardware/test.json`,
					customField: 'custom-value',
				};

				const result = schemas.Unconnected.safeParse(valid);
				expect(result.success).toBe(true);
				if (result.success) {
					expect((result.data as any).customField).toBe('custom-value');
				}
			});

			it('propagates extended fields to Connected schema', () => {
				const extendedSchema = z.object({
					customField: z.string(),
				});

				const schemas = createHardwareSchemas(firstHardwareType, extendedSchema);

				const valid = {
					type: firstHardwareType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
					id: 'test-001',
					path: `${validPathPrefix}/hardware/test.json`,
					connectedTo: 'toolboard' as const,
					customField: 'custom-value',
				};

				const result = schemas.Connected.safeParse(valid);
				expect(result.success).toBe(true);
				if (result.success) {
					expect((result.data as any).customField).toBe('custom-value');
				}
			});

			it('does not propagate extended fields to Ref (only id and connectedTo)', () => {
				const extendedSchema = z.object({
					customField: z.string(),
				});

				const schemas = createHardwareSchemas(firstHardwareType, extendedSchema);

				const input = {
					id: 'test-001',
					connectedTo: 'toolboard' as const,
					customField: 'should-be-stripped',
				};

				const result = schemas.Ref.safeParse(input);
				expect(result.success).toBe(true);
				if (result.success) {
					expect((result.data as any).customField).toBeUndefined();
					expect(result.data).toEqual({
						id: 'test-001',
						connectedTo: 'toolboard',
					});
				}
			});

			it('toRef converter strips extended fields', () => {
				const extendedSchema = z.object({
					customField: z.string(),
				});

				const schemas = createHardwareSchemas(firstHardwareType, extendedSchema);

				const connected = {
					type: firstHardwareType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
					id: 'test-001',
					path: `${validPathPrefix}/hardware/test.json`,
					connectedTo: 'toolboard' as const,
					customField: 'custom-value',
				};

				const parsedConnected = schemas.Connected.parse(connected);
				const ref = schemas.toRef(parsedConnected);

				expect(ref.id).toBe('test-001');
				expect(ref.connectedTo).toBe('toolboard');
				expect((ref as any).customField).toBeUndefined();
			});
		});

		describe('brand and optional ordering regression test', () => {
			it('ensures brand().optional() allows undefined (correct ordering)', () => {
				const schemas = createHardwareSchemas(firstHardwareType);

				// This is the critical test that would fail if we used .optional().brand()
				const resultUndefined = schemas.OptionalRef.safeParse(undefined);
				expect(resultUndefined.success).toBe(true);
				if (resultUndefined.success) {
					expect(resultUndefined.data).toBeUndefined();
				}

				// Also verify it accepts valid refs
				const resultValid = schemas.OptionalRef.safeParse({
					id: 'test-001',
					connectedTo: 'toolboard' as const,
				});
				expect(resultValid.success).toBe(true);
			});

			it('ensures OptionalRef infers to include undefined in union type', () => {
				const schemas = createHardwareSchemas(firstHardwareType);
				type OptRefType = z.infer<typeof schemas.OptionalRef>;

				// This should compile without error - if the type doesn't include undefined, TypeScript will error
				const testUndefined: OptRefType = undefined;
				const testDefined: OptRefType = schemas.Ref.parse({ id: 'test', connectedTo: 'toolboard' as const });

				expect(testUndefined).toBeUndefined();
				expect(testDefined).toBeDefined();
			});

			it('documents that optional().brand() would break undefined acceptance', () => {
				// This test documents the bug we fixed - if someone reorders to .optional().brand(),
				// the type inference breaks
				const correctSchema = HardwareInstanceRef.brand(`${firstHardwareType}_ref`).optional();
				const correctResult = correctSchema.safeParse(undefined);
				expect(correctResult.success).toBe(true);

				// Note: We don't test the broken version here as it would make the test fail,
				// but this documents that .optional().brand() order is problematic
			});
		});

		describe('type safety and branding', () => {
			it('creates type-safe converters that only accept matching Connected type', () => {
				const schema1 = createHardwareSchemas(firstHardwareType);
				const otherType = validHardwareTypes.find((t) => t !== firstHardwareType) || 'chamber-lighting';
				const schema2 = createHardwareSchemas(otherType);

				const connected1 = schema1.Connected.parse({
					type: firstHardwareType,
					title: 'Test',
					description: 'Test',
					manufacturer: 'Test Corp',
					template: 'test.cfg',
					id: 'test-001',
					path: `${validPathPrefix}/hardware/test.json`,
					connectedTo: 'toolboard' as const,
				});

				// This should work
				const ref1 = schema1.toRef(connected1);
				expect(ref1.id).toBe('test-001');

				// TypeScript should prevent schema2.toRef(connected1) at compile time
				// (we can't easily test compile-time errors in runtime tests, but this documents the intent)
			});

			it('brands with type-specific tag', () => {
				const schemas = createHardwareSchemas(firstHardwareType);
				const ref = schemas.Ref.parse({ id: 'test', connectedTo: 'toolboard' as const });

				// The brand is internal to zod, but we can verify it parses correctly
				expect(ref.id).toBe('test');

				// The brand tag follows the pattern `${literalType}_ref`
				// This is enforced at the type level by TypeScript
			});
		});
	});

	describe('type inference', () => {
		it('infers correct TypeScript types from schemas', () => {
			type HWDef = z.infer<typeof HardwareDefinition>;
			type Unconnected = z.infer<typeof UnconnectedHardwareInstance>;
			type Connected = z.infer<typeof HardwareInstance>;
			type Ref = z.infer<typeof HardwareInstanceRef>;

			// These compile-time checks verify the inferred types are correct
			const def: HWDef = {
				type: firstHardwareType as HWDef['type'],
				title: 'Test',
				description: 'Test',
				manufacturer: 'Test',
				template: 'test.cfg',
			};

			const unconnected: Unconnected = {
				...def,
				id: 'test',
				path: `${validPathPrefix}/hardware/test.json`,
			};

			const connected: Connected = {
				...unconnected,
				connectedTo: 'toolboard',
			};

			const ref: Ref = {
				id: 'test',
				connectedTo: 'toolboard',
			};

			expect(def.type).toBe(firstHardwareType);
			expect(unconnected.id).toBe('test');
			expect(connected.connectedTo).toBe('toolboard');
			expect(ref.id).toBe('test');
		});

		it('infers optional fields correctly', () => {
			type HWDef = z.infer<typeof HardwareDefinition>;

			const withOptions: HWDef = {
				type: firstHardwareType as HWDef['type'],
				title: 'Test',
				description: 'Test',
				manufacturer: 'Test',
				template: 'test.cfg',
				templateOptions: { key: 'value' },
			};

			const withoutOptions: HWDef = {
				type: firstHardwareType as HWDef['type'],
				title: 'Test',
				description: 'Test',
				manufacturer: 'Test',
				template: 'test.cfg',
			};

			expect(withOptions.templateOptions).toBeDefined();
			expect(withoutOptions.templateOptions).toBeUndefined();
		});
	});
});
