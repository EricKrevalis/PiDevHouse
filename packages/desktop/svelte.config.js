import adapter from '@sveltejs/adapter-static';

export default {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},

	kit: {
		adapter: adapter({ fallback: 'index.html' }),
		alias: { '@core': '../core/src' }
	}
};
