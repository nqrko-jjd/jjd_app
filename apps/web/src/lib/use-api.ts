'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [resolvedPath, setResolvedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const requestId = useRef(0);

  const reload = useCallback(() => {
    if (!path) return;
    setLoading(true);
    const id = ++requestId.current;
    api<T>(path)
      .then((d) => {
        if (id !== requestId.current) return; // une requête plus récente a déjà répondu
        setData(d);
        setResolvedPath(path);
        setError(null);
      })
      .catch((e) => {
        if (id !== requestId.current) return;
        // pas de données périmées sous l'état d'erreur (sinon « vide » + « erreur » s'affichent ensemble)
        setData(null);
        setResolvedPath(path);
        setError(e.message ?? 'Erreur');
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [path]);

  useEffect(() => {
    ++requestId.current;
    reload();
  }, [reload]);

  // Never show the previous conversation/record while a different URL loads.
  return { data: resolvedPath === path ? data : null, error: resolvedPath === path ? error : null, loading: !!path && (resolvedPath !== path || loading), reload };
}
