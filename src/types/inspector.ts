export interface InspectorPayload {
  id: string; // unique ID for the exchange
  model: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any; // Raw JSON payload
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body: any; // Full JSON response payload
  };
  tokens?: {
    input: number;
    output: number;
  };
  timing: {
    startTime: number; // Date.now()
    firstTokenTime?: number; // Date.now() - startTime
    totalTime?: number; // Date.now() - startTime
  };
}

export interface InspectorState {
  logs: InspectorPayload[];
  actions: {
    addLog: (log: InspectorPayload) => void;
    updateLog: (id: string, update: Partial<InspectorPayload>) => void;
    clearLogs: () => void;
  };
}
