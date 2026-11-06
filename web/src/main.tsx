import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '@/components/ui/toast';
import { createQueryClient } from '@/core/query-client';
import { routeTree } from '@/route-tree.gen';
import './index.css';

const queryClient = createQueryClient();
const router = createRouter({
  routeTree,
  // Toasts are drawn inside the router, so one can hold a router link ("Go to Media" after a move).
  InnerWrap: ({ children }) => <ToastProvider>{children}</ToastProvider>,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (root === null) {
  throw new Error('#root is missing from index.html');
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
