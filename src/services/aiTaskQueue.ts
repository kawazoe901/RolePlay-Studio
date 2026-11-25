export type AiTaskKind = 'llm-chat' | 'llm-helper' | 'comfy-image' | 'tts-audio';

export interface AiQueueItem {
  id: string;
  kind: AiTaskKind;
  label: string;
  status: 'queued' | 'running';
  detail?: string;
  enqueuedAt: number;
}

export interface AiQueueSnapshot {
  activeTask: AiQueueItem | null;
  pendingTasks: AiQueueItem[];
}

interface InternalQueueEntry<T = any> {
  item: AiQueueItem;
  run: (updateDetail: (detail: string) => void) => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: any) => void;
  cancelled?: boolean;
}

class GlobalAiTaskQueue {
  private queue: InternalQueueEntry[] = [];
  private activeEntry: InternalQueueEntry | null = null;
  private listeners = new Set<() => void>();
  private snapshot: AiQueueSnapshot = {
    activeTask: null,
    pendingTasks: [],
  };

  private emit() {
    this.snapshot = {
      activeTask: this.activeEntry ? { ...this.activeEntry.item } : null,
      pendingTasks: this.queue
        .filter((q) => !q.cancelled)
        .map((q) => ({ ...q.item })),
    };
    for (const listener of this.listeners) {
      listener();
    }
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getSnapshot = (): AiQueueSnapshot => {
    return this.snapshot;
  };

  /**
   * Enqueues an AI task (LLM text generation, LLM helper prompt, or ComfyUI image render)
   * so that only ONE heavy GPU operation runs at a time, preventing LLM + ComfyUI from
   * competing for VRAM/compute and hanging the PC.
   */
  public enqueue<T>(
    kind: AiTaskKind,
    label: string,
    run: (updateDetail: (detail: string) => void) => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: AiQueueItem = {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        label,
        status: 'queued',
        enqueuedAt: Date.now(),
      };

      const entry: InternalQueueEntry<T> = {
        item,
        run,
        resolve,
        reject,
      };

      this.queue.push(entry);
      this.emit();
      this.processNext();
    });
  }

  /**
   * Cancels a waiting task in the queue (before it starts running).
   */
  public cancelPendingTask(taskId: string) {
    const idx = this.queue.findIndex((e) => e.item.id === taskId);
    if (idx !== -1) {
      const [removed] = this.queue.splice(idx, 1);
      removed.cancelled = true;
      removed.reject(new Error(`Task "${removed.item.label}" was cancelled from queue.`));
      this.emit();
    }
  }

  /**
   * Clears all waiting tasks in the queue.
   */
  public clearPendingQueue() {
    while (this.queue.length > 0) {
      const removed = this.queue.shift()!;
      removed.cancelled = true;
      removed.reject(new Error(`Task "${removed.item.label}" was cancelled.`));
    }
    this.emit();
  }

  private async processNext() {
    if (this.activeEntry || this.queue.length === 0) {
      return;
    }

    const next = this.queue.shift()!;
    if (next.cancelled) {
      this.processNext();
      return;
    }

    this.activeEntry = next;
    this.activeEntry.item.status = 'running';
    this.emit();

    const updateDetail = (detail: string) => {
      if (this.activeEntry && this.activeEntry.item.id === next.item.id) {
        this.activeEntry.item.detail = detail;
        this.emit();
      }
    };

    try {
      const result = await next.run(updateDetail);
      next.resolve(result);
    } catch (err) {
      next.reject(err);
    } finally {
      this.activeEntry = null;
      this.emit();
      // Small breathing pause (150ms) between sequential GPU tasks so drivers settle
      setTimeout(() => {
        this.processNext();
      }, 150);
    }
  }
}

export const aiTaskQueue = new GlobalAiTaskQueue();
