import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import type { AssistantClient, AssistantSession } from "@symphoneer/assistant-client";
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
  onRunFinished,
  selectedAttempt,
  selectedTask,
  session,
}: {
  client: AssistantClient;
  dictionary: Dictionary;
  onRunFinished: () => void;
  selectedAttempt: AttemptSnapshot | null;
  selectedTask: TaskSummary | null;
  session: AssistantSession;
}) {
  const adapter = useMemo(
    () => createAssistantUiChatModelAdapter(client, session.id, onRunFinished),
    [client, onRunFinished, session.id],
  );
  const initialMessages = useMemo(
    () => toAssistantUiMessages(session.messages),
    [session.messages],
  );
  const runtime = useLocalRuntime(adapter, { initialMessages });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DeliveryAssistantThread
          client={client}
          dictionary={dictionary}
          selectedAttempt={selectedAttempt}
          selectedTask={selectedTask}
          sessionId={session.id}
        />
      </div>
    </AssistantRuntimeProvider>
  );
}
