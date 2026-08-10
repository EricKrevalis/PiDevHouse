export type Theme = {
	id: string;
	name: string;
	mode: 'light' | 'dark';
};

export const themeGroups: { name: string; themes: Theme[] }[] = [
	{
		name: 'Catppuccin',
		themes: [
			{ id: 'catppuccin-latte', name: 'Latte', mode: 'light' },
			{ id: 'catppuccin-frappe', name: 'Frappe', mode: 'dark' },
			{ id: 'catppuccin-macchiato', name: 'Macchiato', mode: 'dark' },
			{ id: 'catppuccin-mocha', name: 'Mocha', mode: 'dark' }
		]
	},
	{
		name: 'Gruvbox',
		themes: [
			{ id: 'gruvbox-light', name: 'Light', mode: 'light' },
			{ id: 'gruvbox-dark', name: 'Dark', mode: 'dark' }
		]
	},
	{
		name: 'Nord',
		themes: [
			{ id: 'nord-light', name: 'Light', mode: 'light' },
			{ id: 'nord', name: 'Nord', mode: 'dark' }
		]
	},
	{
		name: 'Tokyo Night',
		themes: [
			{ id: 'tokyo-night-light', name: 'Light', mode: 'light' },
			{ id: 'tokyo-night-dark', name: 'Night', mode: 'dark' },
			{ id: 'tokyo-night-moon', name: 'Moon', mode: 'dark' },
			{ id: 'tokyo-night-storm', name: 'Storm', mode: 'dark' }
		]
	}
];
