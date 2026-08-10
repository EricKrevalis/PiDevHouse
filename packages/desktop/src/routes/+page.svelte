<script lang="ts">
	import { ArrowUp } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Toggle from '$lib/components/toggle.svelte';

	const API = 'http://127.0.0.1:8765';
	let request = $state('');
	let stream = $state('');
	let status = $state('');
	let running = $state(false);
	let socket;
	let log: HTMLDivElement | undefined = $state(undefined);

	function send() {
		if (!request.trim() || running) return;
		const text = request.trim();
		running = true;
		stream = '';
		status = 'Starting run...';
		socket = new WebSocket('ws://127.0.0.1:8765');
		socket.onopen = () =>
			fetch(`${API}/runs`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ request: text })
			}).catch(() => {
				running = false;
				status = 'Failed to start run — is the backend running? (deno task dev)';
			});
		socket.onmessage = (event) => {
			stream += event.data;
			if (event.data.includes('=== Run ')) {
				running = false;
				status = 'Run finished';
			}
			log?.scrollTo(0, 0);
		};
		socket.onerror = () => {
			running = false;
			status = 'Could not connect to the backend — is it running? (deno task dev)';
		};
		socket.onclose = () => {
			running = false;
			if (status === 'Run finished') status = '';
		};
	}
</script>

<div class="flex min-h-0 w-[85vw] flex-1 flex-col items-center justify-between py-4">
	<div class="flex min-h-0 w-full flex-1 flex-col gap-4">
		<header class="grid w-full grid-cols-3">
			<div class="col-start-2 justify-self-center text-center">
				<h1 class="text-2xl font-bold">Concentus</h1>
			</div>
			<Toggle class="col-start-3 justify-self-end" />
		</header>
		<div class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
			<p class="text-center font-bold">{request || 'Story title'}</p>
			<div class="flex min-h-0 w-full flex-1 flex-col-reverse overflow-auto" bind:this={log}>
				<div class="break-words whitespace-pre-wrap">{stream}</div>
			</div>
		</div>
	</div>
	{#if status}
		<p class="mb-2 text-sm text-foreground/60">{status}</p>
	{/if}
	<div class="flex w-full flex-row items-center justify-center rounded-full border p-2">
		<input
			type="text"
			placeholder="Enter your feature request..."
			class="w-full px-2 focus:outline-none disabled:opacity-50"
			bind:value={request}
			disabled={running}
			onkeydown={(event) => event.key === 'Enter' && send()}
		/>
		<Button class="h-full rounded-full p-2" disabled={running} onclick={send}>
			<ArrowUp />
		</Button>
	</div>
</div>
