import {
  AssistantRuntimeProvider,
  SimpleTextAttachmentAdapter,
  useLocalRuntime,
} from "@assistant-ui/react";
import type {
  AssistantClient,
  AssistantModelOption,
  AssistantSession,
  AssistantThinkingLevel,
} from "@symphoneer/assistant-client";
import type { AttemptSnapshot, TaskSummary } from "@symphoneer/contracts";
import { useMemo } from "react";
import type { Dictionary } from "../../i18n/index.ts";
import {
  createAssistantUiChatModelAdapter,
  toAssistantUiMessages,
} from "./assistant-ui-adapter.ts";
import { DeliveryAssistantThread } from "./thread.tsx";

export function AssistantSessionRuntime({
  client,
  dictionary,
  modelOptions,
  onCreateSession,
  onRunError,
  onRunFinished,
  selectedAttempt,
  selectedTask,
  session,
}: {
  client: AssistantClient;
  dictionary: Dictionary;
  modelOptions: AssistantModelOption[];
  onCreateSession: (options: {
    model: string;
    thinkingLevel: AssistantThinkingLevel;
  }) => Promise<void>;
  onRunError: (message: string) => void;
  onRunFinished: () => void;
  selectedAttempt: AttemptSnapshot | null;
  selectedTask: TaskSummary | null;
  session: AssistantSession;
}) {
  const adapter = useMemo(
    () => createAssistantUiChatModelAdapter(client, session.id, onRunFinished, onRunError),
    [client, onRunError, onRunFinished, session.id],
  );
  const initialMessages = useMemo(
    () => toAssistantUiMessages(session.messages),
    [session.messages],
  );
  const attachments = useMemo(() => new SimpleTextAttachmentAdapter(), []);
  const runtime = useLocalRuntime(adapter, {
    initialMessages,
    adapters: { attachments },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DeliveryAssistantThread
          client={client}
          dictionary={dictionary}
          model={session.model}
          modelOptions={modelOptions}
          onCreateSession={onCreateSession}
          selectedAttempt={selectedAttempt}
          selectedTask={selectedTask}
          sessionId={session.id}
          thinkingLevel={session.thinkingLevel}
        />
      </div>
    </AssistantRuntimeProvider>
  );
}
