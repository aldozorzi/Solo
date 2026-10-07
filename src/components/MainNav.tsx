'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, House, Receipt, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MainNavCounts {
  payments: number | null;
  invoices: number | null;
  clients: number | null;
}

interface MainNavProps {
  isAdmin: boolean;
  counts: MainNavCounts;
}

export function MainNav({ isAdmin, counts }: MainNavProps) {
  const pathname = usePathname();
  const items = [
    { href: '/', label: 'Dashboard', icon: House, count: null },
    { href: '/incassi', label: 'Incassi', icon: Receipt, count: counts.payments },
    { href: '/fatture', label: 'Fatture', icon: FileText, count: counts.invoices },
    { href: '/clienti', label: 'Clienti', icon: Users, count: counts.clients },
    ...(isAdmin ? [{ href: '/utenti', label: 'Utenti', icon: Users, count: null }] : []),
    { href: '/impostazioni', label: 'Impostazioni', icon: Settings, count: null },
  ];

  return (
    <nav aria-label="Navigazione principale" className="w-full">
      <div className="main-nav">
        {items.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn('main-nav-item', isActive && 'main-nav-item-active')}
            >
              <span className="flex items-center gap-2">
                <item.icon className="w-4 h-4" />
                {item.label}
                {item.count !== null && (
                  <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{item.count}</span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
