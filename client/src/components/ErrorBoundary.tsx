// Si una vista falla, muestra el error sin tumbar toda la app.
import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty">
        <div>
          <p>😵 Algo falló en esta sección.</p>
          <pre className="pre">{this.state.error.message}</pre>
          <button className="btn btn--primary" onClick={() => this.setState({ error: null })}>Reintentar</button>{' '}
          <button className="btn btn--ghost" onClick={() => location.reload()}>Recargar la página</button>
        </div>
      </div>
    );
  }
}
