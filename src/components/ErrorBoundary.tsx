import { Component } from "react";
import { startupError } from "@/lib/utils/startupDiagnostics";
import { devLog } from "@/features/debug-overlay/devLog";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    devLog("error", "react", "Error boundary caught render failure", {
      error,
      componentStackLength: info.componentStack?.length ?? 0,
    });
    startupError("React error boundary caught render failure", `${error.message}\n${info.componentStack}`);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-screen">
          <h1 className="error-boundary-title">Something went wrong</h1>
          <p className="error-boundary-message">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={this.handleReset}
            className="error-boundary-button"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
