<script lang="ts">
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import { mode, setMode, setTheme, theme } from 'mode-watcher';

	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { themeGroups, type Theme } from '$lib/themes.js';
	import '$lib/themes.css';

	let { class: className = '' }: { class?: string } = $props();
	let open = $state(false);
	let activeTheme = $derived(
		theme.current || (mode.current === 'light' ? 'catppuccin-latte' : 'catppuccin-macchiato')
	);

	function selectTheme(selectedTheme: Theme) {
		setMode(selectedTheme.mode);
		setTheme(selectedTheme.id);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger class={buttonVariants({ variant: 'outline', size: 'icon', class: className })}>
		<PaletteIcon />
		<span class="sr-only">Choose theme</span>
	</Dialog.Trigger>
	<Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Choose theme</Dialog.Title>
			<Dialog.Description>Changes are saved for future visits.</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4">
			{#each themeGroups as group}
				<section class="grid gap-2" aria-labelledby={`${group.name}-themes`}>
					<h2 id={`${group.name}-themes`} class="text-sm text-muted-foreground">
						{group.name}
					</h2>
					<div class="grid grid-cols-2 gap-2">
						{#each group.themes as selectedTheme}
							<button
								type="button"
								data-theme={selectedTheme.id}
								aria-pressed={activeTheme === selectedTheme.id}
								onclick={() => selectTheme(selectedTheme)}
								class="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-border bg-background p-3 text-left text-foreground transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-pressed:ring-2 aria-pressed:ring-ring"
							>
								<span class="text-sm font-medium">{selectedTheme.name}</span>
								<span class="flex overflow-hidden rounded-md border border-border">
									<span class="size-3 bg-(--base00)"></span>
									<span class="size-3 bg-(--base05)"></span>
									<span class="size-3 bg-(--base0d)"></span>
									<span class="size-3 bg-(--base0e)"></span>
								</span>
							</button>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	</Dialog.Content>
</Dialog.Root>
