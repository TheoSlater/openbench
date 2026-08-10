type ChatPanelProps = {
  children: React.ReactNode;
  backgroundImage?: string | null;
};

export function ChatPanel({ children, backgroundImage }: ChatPanelProps) {
  return (
    <div
      data-chat-panel
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-tl-(--sidebar-panel-radius) bg-sidebar"
    >
      {backgroundImage && (
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat blur-3xl"
          style={{ backgroundImage: `url(${backgroundImage})` }}
        />
      )}
      {backgroundImage && (
        <div className="absolute inset-0 bg-black/35" />
      )}
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
