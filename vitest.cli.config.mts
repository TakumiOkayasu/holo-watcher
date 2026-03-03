import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/sync-webhooks-cli.spec.ts'],
	},
});
