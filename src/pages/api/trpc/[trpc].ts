import { getLogger } from '@/server/helpers/logger';
import { appRouter } from '@/server/routers/index';
import * as trpcNext from '@trpc/server/adapters/next';
import { ZodError } from 'zod';

// export type definition of API
export type AppRouter = typeof appRouter;

export const config = {
	api: {
		bodyParser: {
			sizeLimit: '100mb',
		},
		responseLimit: '100mb',
	},
};

// export API handler
export default trpcNext.createNextApiHandler({
	router: appRouter,
	createContext: () => ({
		boards: [],
	}),
	onError: (ctx) => {
		if (ctx.error.code === 'BAD_REQUEST' && ctx.error.cause instanceof ZodError) {
			getLogger().error(`tRPC Validation Error on '${ctx.path}':\n${ctx.error.message}`);
			getLogger().error(ctx.input, 'Input received:');
		} else {
			getLogger().error(ctx.error, `tRPC Error on '${ctx.path}'`);
		}
	},
});
