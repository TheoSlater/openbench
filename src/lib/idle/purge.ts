import { idleManager } from './manager'
import { useChatStore } from '@/store/chatStore'
import { useModelStore } from '@/store/modelStore'
import { useFolderStore } from '@/store/folderStore'
import { useNotificationStore } from '@/store/notificationStore'

function notifyRestoreFailed(): void {
  useNotificationStore.getState().actions.add({
    type: 'error',
    message: 'Failed to restore conversations',
    description: 'Some chats may be missing — try switching conversations.',
    duration: 5000,
  })
}

function setCache(key: string, data: unknown): void {
  try { sessionStorage.setItem('idle:' + key, JSON.stringify(data)) } catch {}
}
function getCache<T>(key: string): T | null {
  try { const r = sessionStorage.getItem('idle:' + key); return r ? JSON.parse(r) as T : null } catch { return null }
}

export function registerMemoryPurge(): void {
  idleManager.register('memory-purge', {
    onPause: () => {
      const chat = useChatStore.getState()
      const model = useModelStore.getState()
      const folder = useFolderStore.getState()

      setCache('messages', chat.messages)
      setCache('activeConversationId', chat.activeConversationId)
      setCache('hasMoreMessages', chat.hasMoreMessages)
      setCache('conversations', chat.conversations)
      setCache('streamingMessages', chat.streamingMessages)
      setCache('systemPrompts', model.systemPrompts)
      setCache('activeSystemPromptId', model.activeSystemPromptId)
      setCache('folders', folder.folders)
      setCache('activeFolderId', folder.activeFolderId)

      useChatStore.setState({
        messages: [],
        conversations: [],
        streamingMessages: {},
        attachmentsByChat: {},
        messageQueue: [],
      })
      useModelStore.setState({ systemPrompts: [], activeSystemPromptId: null })
      useFolderStore.setState({ folders: [], activeFolderId: null })
    },
    onResume: () => {
      const msgs = getCache<any[]>('messages')
      const convId = getCache<string | null>('activeConversationId')
      const hasMore = getCache<boolean>('hasMoreMessages')
      const convs = getCache<any[]>('conversations')
      const streamMsgs = getCache<Record<string, any>>('streamingMessages')
      const prompts = getCache<any[]>('systemPrompts')
      const promptId = getCache<string | null>('activeSystemPromptId')
      const folders = getCache<any[]>('folders')
      const folderId = getCache<string | null>('activeFolderId')

      if (msgs) useChatStore.setState({ messages: msgs })
      if (convId !== null) useChatStore.setState({ activeConversationId: convId })
      if (hasMore !== null) useChatStore.setState({ hasMoreMessages: hasMore ?? false })
      if (convs) useChatStore.setState({ conversations: convs })
      if (streamMsgs) useChatStore.setState({ streamingMessages: streamMsgs })
      if (prompts) useModelStore.setState({ systemPrompts: prompts })
      if (promptId !== null) useModelStore.setState({ activeSystemPromptId: promptId })
      if (folders) useFolderStore.setState({ folders: folders })
      if (folderId !== null) useFolderStore.setState({ activeFolderId: folderId })

      if (convId) useChatStore.getState().actions.setActiveConversationId(convId).catch(notifyRestoreFailed)
      useChatStore.getState().actions.loadConversations().catch(notifyRestoreFailed)
    },
    priority: 200,
  })
}
