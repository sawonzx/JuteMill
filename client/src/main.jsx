import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }
  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }
  componentDidCatch(error, errorInfo) {
    console.error('Uncaught React render error:', error, errorInfo);
    this.setState({
      errorInfo,
    });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '40px',
            fontFamily: 'system-ui, sans-serif',
            maxWidth: '800px',
            margin: '40px auto',
            background: '#fff',
            border: '1px solid #e2e8e4',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          <h2
            style={{
              color: '#b91c1c',
              marginTop: 0,
            }}
          >
            Application Render Error
          </h2>
          <p
            style={{
              color: '#4b5563',
              fontSize: '15px',
            }}
          >
            An unhandled error occurred while rendering the page:
          </p>
          <pre
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              padding: '16px',
              borderRadius: '6px',
              color: '#991b1b',
              overflowX: 'auto',
              fontSize: '13px',
            }}
          >
            {this.state.error?.toString()}
          </pre>
          {this.state.errorInfo?.componentStack && (
            <pre
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                padding: '16px',
                borderRadius: '6px',
                color: '#374151',
                overflowX: 'auto',
                fontSize: '12px',
                marginTop: '12px',
              }}
            >
              {this.state.errorInfo.componentStack}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '16px',
              padding: '8px 18px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
