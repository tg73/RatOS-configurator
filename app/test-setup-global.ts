import dotenv from 'dotenv';
import { existsSync } from 'fs';

export const setup = () => {
	if (existsSync('./.env.test')) {
		dotenv.config({ path: './.env.test' });
	}
	if (existsSync('./.env.test.local')) {
		dotenv.config({ path: './.env.test.local' });
	}
};
