import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Lets a link such as `/sales?action=new` open a page's own "new" dialog. The parameter is removed
 * straight away so a refresh does not open it again, and `enabled` lets the page apply the same
 * permission check as its button, so a typed address gets nothing the button would not.
 */
export function useActionParam(action: string, enabled: boolean, onAction: () => void): void {
  const [params, setParams] = useSearchParams();
  const handler = useRef(onAction);
  useEffect(() => {
    handler.current = onAction;
  });
  const requested = params.get('action') === action;
  useEffect(() => {
    if (!requested) return;
    const next = new URLSearchParams(params);
    next.delete('action');
    setParams(next, { replace: true });
    if (enabled) handler.current();
  }, [requested, enabled, params, setParams]);
}
