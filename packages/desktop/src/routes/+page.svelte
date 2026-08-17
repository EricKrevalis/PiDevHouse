<script lang="ts">
	import { ArrowUp } from '@lucide/svelte';
	import type { Message, RunStatus } from '@core/modules/model/message.model';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button';
	import Toggle from '$lib/components/toggle.svelte';

	const API = 'http://127.0.0.1:8765';

	type AgentBlock = {
		id: string;
		agent: string;
		storyId?: number;
		iteration?: number;
		content: string;
		tools: string[];
		thinking: boolean;
		state: 'running' | 'complete';
	};

	type TraceSelection = 'planning' | number;

	let request = $state('');
	let runRequest = $state('');
	let blocks = $state<AgentBlock[]>([]);
	let scores = $state<Record<number, Partial<Record<'review' | 'test', number>>>>({});
	let blockedStories = $state<Record<number, string>>({});
	let totalStories = $state(0);
	let status = $state<'idle' | RunStatus>('idle');
	let detail = $state('');
	let running = $state(false);
	let selectedTrace = $state<TraceSelection>('planning');
	let socket: WebSocket | undefined;
	let blockSequence = 0;
	let activeBlocks = new SvelteMap<string, string>();

	let storyIds = $derived.by(() => {
		const ids = new SvelteSet(blocks.flatMap((block) => (block.storyId ? [block.storyId] : [])));
		for (let id = 1; id <= totalStories; id++) ids.add(id);
		return [...ids].sort((a, b) => a - b);
	});
	let planningBlocks = $derived(blocks.filter((block) => block.storyId === undefined));
	let selectedBlocks = $derived(
		selectedTrace === 'planning' ? planningBlocks : storyBlocks(selectedTrace)
	);
	let selectedTitle = $derived(
		selectedTrace === 'planning' ? 'Product owner' : `Story ${selectedTrace}`
	);
	let selectedStatus = $derived(
		selectedTrace === 'planning'
			? planningBlocks.some((block) => block.state === 'running')
				? 'In progress'
				: planningBlocks.length
					? 'Complete'
					: runStatusLabel()
			: statusLabel(storyStatus(selectedTrace))
	);

	function scopeKey(agent: string, storyId?: number, iteration?: number): string {
		return `${agent}:${storyId ?? 'planning'}:${iteration ?? 0}`;
	}

	function agentName(agent: string): string {
		return agent
			.replaceAll('_', ' ')
			.replace(/([a-z])([A-Z])/g, '$1 $2')
			.replace(/\b\w/g, (letter) => letter.toUpperCase());
	}

	function storyBlocks(storyId: number): AgentBlock[] {
		return blocks.filter((block) => block.storyId === storyId);
	}

	function storyStatus(storyId: number): 'waiting' | 'working' | 'reviewed' | 'tested' | 'blocked' {
		if (blockedStories[storyId]) return 'blocked';
		const story = storyBlocks(storyId);
		if (!story.length) return 'waiting';
		if (story.some((block) => block.state === 'running')) return 'working';
		if (scores[storyId]?.test !== undefined) return 'tested';
		if (scores[storyId]?.review !== undefined) return 'reviewed';
		return 'working';
	}

	function statusLabel(value: ReturnType<typeof storyStatus>): string {
		return {
			waiting: 'Waiting',
			working: 'In progress',
			reviewed: 'Reviewed',
			tested: 'Verified',
			blocked: 'Blocked'
		}[value];
	}

	function runStatusLabel(): string {
		return {
			idle: 'Ready',
			running: 'Running',
			retry: 'Retrying',
			completed: 'Completed',
			incomplete: 'Incomplete',
			blocked: 'Blocked',
			failed: 'Failed',
			cancelled: 'Cancelled'
		}[status];
	}

	function findBlock(message: Extract<Message, { agent: string }>): AgentBlock | undefined {
		const activeId = activeBlocks.get(scopeKey(message.agent, message.storyId, message.iteration));
		return (
			blocks.find((block) => block.id === activeId) ??
			[...blocks]
				.reverse()
				.find(
					(block) =>
						block.agent === message.agent &&
						block.storyId === message.storyId &&
						block.iteration === message.iteration
				)
		);
	}

	function updateBlock(id: string, update: (block: AgentBlock) => AgentBlock): void {
		blocks = blocks.map((block) => (block.id === id ? update(block) : block));
	}

	function handleMessage(message: Message): void {
		switch (message.type) {
			case 'run_info':
				totalStories = message.totalStories;
				break;
			case 'agent_start': {
				const id = `block-${++blockSequence}`;
				blocks = [
					...blocks,
					{
						id,
						agent: message.agent,
						storyId: message.storyId,
						iteration: message.iteration,
						content: '',
						tools: [],
						thinking: false,
						state: 'running'
					}
				];
				activeBlocks.set(scopeKey(message.agent, message.storyId, message.iteration), id);
				break;
			}
			case 'text_delta': {
				const block = findBlock(message);
				if (block)
					updateBlock(block.id, (current) => ({
						...current,
						content: current.content + message.delta,
						thinking: false
					}));
				break;
			}
			case 'thinking_start': {
				const block = findBlock(message);
				if (block) updateBlock(block.id, (current) => ({ ...current, thinking: true }));
				break;
			}
			case 'thinking_end': {
				const block = findBlock(message);
				if (block) updateBlock(block.id, (current) => ({ ...current, thinking: false }));
				break;
			}
			case 'tool_start': {
				const block = findBlock(message);
				if (block)
					updateBlock(block.id, (current) => ({
						...current,
						tools: [...current.tools, message.tool]
					}));
				break;
			}
			case 'agent_end': {
				const block = findBlock(message);
				if (block)
					updateBlock(block.id, (current) => ({ ...current, state: 'complete', thinking: false }));
				activeBlocks.delete(scopeKey(message.agent, message.storyId, message.iteration));
				break;
			}
			case 'story_score':
				scores = {
					...scores,
					[message.storyId]: { ...scores[message.storyId], [message.variant]: message.score }
				};
				break;
			case 'story_blocked':
				blockedStories = { ...blockedStories, [message.storyId]: message.detail };
				break;
			case 'run_status':
				status = message.status;
				detail = message.error ?? message.detail ?? '';
				if (message.status !== 'retry' && message.status !== 'running') running = false;
				break;
			case 'text_end':
			case 'tool_end':
			case 'elapsed':
				break;
		}
	}

	function resetRun(): void {
		blocks = [];
		scores = {};
		blockedStories = {};
		totalStories = 0;
		status = 'running';
		detail = '';
		selectedTrace = 'planning';
		blockSequence = 0;
		activeBlocks = new SvelteMap();
	}

	async function send(): Promise<void> {
		if (!request.trim() || running) return;

		runRequest = request.trim();
		running = true;
		resetRun();

		try {
			const response = await fetch(`${API}/runs`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ request: runRequest })
			});
			if (!response.ok) throw new Error('Could not start the run');
			const { runId } = (await response.json()) as { runId: string };

			socket = new WebSocket('ws://127.0.0.1:8765');
			socket.onopen = () => socket?.send(JSON.stringify({ type: 'subscribe', runId }));
			socket.onmessage = (event) => {
				try {
					handleMessage(JSON.parse(event.data) as Message);
				} catch {
					detail = 'Received an invalid event from the service';
				}
			};
			socket.onerror = () => {
				status = 'failed';
				detail = 'The connection to the service was lost';
				running = false;
			};
			socket.onclose = () => {
				if (running) {
					status = 'failed';
					detail = 'The connection to the service was closed';
					running = false;
				}
			};
		} catch (error) {
			status = 'failed';
			detail = error instanceof Error ? error.message : 'Could not start the run';
			running = false;
		}
	}
</script>

<svelte:head>
	<title>Concentus</title>
</svelte:head>

<div
	class="flex h-screen min-h-[100dvh] w-full flex-col items-center justify-between overflow-hidden py-6"
>
	<div class="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-6 px-4 sm:px-6">
		<header class="grid w-full grid-cols-3 items-center">
			<div class="col-start-2 justify-self-center text-center">
				<h1 class="text-lg font-semibold tracking-tight">Concentus</h1>
				{#if runRequest}<p class="max-w-[50vw] truncate text-xs text-muted-foreground">
						{runRequest}
					</p>{/if}
			</div>
			<div class="col-start-3 justify-self-end">
				<Toggle class="border-0 bg-transparent shadow-none" />
			</div>
		</header>

		<div class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
			{#if status === 'idle'}
				<div class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
					Enter a feature request to start a run.
				</div>
			{:else}
				<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden py-3 lg:flex-row">
					<aside class="shrink-0 lg:w-56" aria-label="Run traces">
						<nav class="flex gap-1 overflow-x-auto lg:flex-col">
							<button
								type="button"
								class="min-w-24 shrink-0 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:min-w-0"
								class:bg-muted={selectedTrace === 'planning'}
								class:text-foreground={selectedTrace === 'planning'}
								aria-pressed={selectedTrace === 'planning'}
								onclick={() => (selectedTrace = 'planning')}
							>
								Plan
							</button>
							{#each storyIds as storyId (storyId)}
								<button
									type="button"
									class="min-w-24 shrink-0 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:min-w-0"
									class:bg-muted={selectedTrace === storyId}
									class:text-foreground={selectedTrace === storyId}
									aria-pressed={selectedTrace === storyId}
									onclick={() => (selectedTrace = storyId)}
								>
									Story {storyId}
								</button>
							{/each}
						</nav>
					</aside>

					<section class="flex min-h-0 min-w-0 flex-1 flex-col" aria-labelledby="trace-title">
						<header class="flex items-center justify-between gap-3 border-b border-border pb-3">
							<div class="min-w-0">
								<h2 id="trace-title" class="truncate font-semibold">{selectedTitle}</h2>
								{#if selectedTrace !== 'planning'}<p class="text-xs text-muted-foreground">
										{statusLabel(storyStatus(selectedTrace))}
									</p>{/if}
							</div>
							<span class="shrink-0 text-xs text-muted-foreground">{selectedStatus}</span>
						</header>

						<div class="min-h-0 flex-1 space-y-3 overflow-auto pt-4">
							{#if detail}<p class="text-sm text-destructive">{detail}</p>{/if}

							{#if selectedBlocks.length}
								{#each selectedBlocks as block (block.id)}{@render agentBlock(block)}{/each}
							{:else}
								<p class="py-8 text-sm text-muted-foreground">
									{selectedTrace === 'planning'
										? 'Waiting for the product owner trace.'
										: 'Waiting for this story to start.'}
								</p>
							{/if}

							{#if selectedTrace !== 'planning' && (scores[selectedTrace]?.review !== undefined || scores[selectedTrace]?.test !== undefined)}
								<div
									class="flex gap-3 border-t border-border/70 pt-3 text-xs text-muted-foreground"
								>
									{#if scores[selectedTrace]?.review !== undefined}<span
											>Review <strong class="text-foreground"
												>{scores[selectedTrace]?.review}/100</strong
											></span
										>{/if}
									{#if scores[selectedTrace]?.test !== undefined}<span
											>Test <strong class="text-foreground"
												>{scores[selectedTrace]?.test}/100</strong
											></span
										>{/if}
								</div>
							{/if}
						</div>
					</section>
				</div>
			{/if}
		</div>
	</div>

	<form
		class="mx-4 flex w-[calc(100%-2rem)] max-w-3xl flex-row items-center justify-center rounded-xl border border-border/70 bg-background px-3 py-2"
		onsubmit={(event) => {
			event.preventDefault();
			send();
		}}
	>
		<input
			type="text"
			placeholder="Enter your feature request..."
			class="w-full bg-transparent px-2 focus:outline-none disabled:opacity-50"
			bind:value={request}
			disabled={running}
			aria-label="Feature request"
		/>
		<Button
			type="submit"
			variant="ghost"
			size="icon-sm"
			disabled={running || !request.trim()}
			aria-label="Start run"><ArrowUp /></Button
		>
	</form>
</div>

{#snippet agentBlock(block: AgentBlock)}
	<div class="border-b border-border/70 py-3 last:border-b-0">
		<div class="flex items-center justify-between gap-2">
			<div class="flex min-w-0 items-center gap-2">
				<span class="truncate text-sm font-medium">{agentName(block.agent)}</span>
				{#if block.iteration}<span class="text-xs text-muted-foreground"
						>iteration {block.iteration}</span
					>{/if}
			</div>
			<span class="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
				><span
					class="size-1.5 rounded-full"
					class:bg-primary={block.state === 'running'}
					class:bg-muted-foreground={block.state === 'complete'}
				></span>{block.state === 'running'
					? block.thinking
						? 'thinking'
						: 'working'
					: 'done'}</span
			>
		</div>
		{#if block.tools.length}<p class="mt-1 font-mono text-xs text-muted-foreground">
				{block.tools.join('  ·  ')}
			</p>{/if}
		{#if block.thinking && !block.content}<p class="mt-1 text-sm text-muted-foreground">
				Working through the next step...
			</p>{:else if block.content}<div
				class="mt-1 max-h-56 overflow-auto text-sm leading-6 break-words whitespace-pre-wrap text-muted-foreground"
			>
				{block.content}
			</div>{/if}
	</div>
{/snippet}
