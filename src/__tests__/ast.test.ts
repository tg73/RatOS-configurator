/* eslint-disable no-console */
import { describe, test } from 'vitest';

import * as ts from 'typescript';
import { boolean } from 'zod';

type State = Map<string, any>;
type GetState = (name: string) => any;
type StateAction = (s: GetState) => boolean;

describe('ast-tests', (async) => {
	test('t1', async () => {
		const state: State = new Map<string, any>();

		// Activation actions must not mutate state


		const action: StateAction = (s) => {
			return !!s('fl');
		};

		console.log(action.toString());
		console.log(action((name: string ) => state.get(name) ));
		state.set('fl', true);
		console.log(action((name: string ) => state.get(name) ));
	
	})
	// test('test-pipeline-split-window-stringifier-writestream', async () => {
	// 	const code = 'if ( x == 1 ) { console.log(`${foo}`) }';
	// 	let sf = ts.createSourceFile('x.ts', code, ts.ScriptTarget.ES2015, true);
	// 	let node: ts.Node = sf;
		
	// 	let indent = 0;
	// 	function print(node: ts.Node) {
	// 		console.log(new Array(indent + 1).join(" ") + ts.SyntaxKind[node.kind]);
	// 		indent++;
	// 		ts.forEachChild(node, print);
	// 		indent--;
	// 	}
		 
	// 	print(sf);
	// });
});