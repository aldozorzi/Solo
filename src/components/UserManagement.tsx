'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableHead } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Edit, Trash2, Shield, UserPlus, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmPasswordDialog } from './ConfirmPasswordDialog';
import { UserRole, USER_ROLE_LABELS, TAX_REGIME_LABELS, SenderType } from '@/types';

interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  businessName: string;
  vatNumber: string;
  taxCode: string;
  address: string;
  city: string;
  zipCode: string;
  province: string;
  country: string;
  taxRegime: 'FORFETTARIO' | 'ORDINARIO';
  senderType: SenderType;
  createdAt: string;
  _count: {
    clients: number;
    invoices: number;
  };
}

interface UserManagementProps {
  onRefresh: () => void;
}

const userSchema = z.object({
  email: z.string().email('Email non valida'),
  name: z.string().min(1, 'Nome obbligatorio'),
  businessName: z.string().min(1, 'Denominazione obbligatoria'),
  vatNumber: z.string().length(11, 'Partita IVA deve essere 11 cifre'),
  taxCode: z.string().length(16, 'Codice Fiscale deve essere 16 caratteri'),
  address: z.string().min(1, 'Indirizzo obbligatorio'),
  city: z.string().min(1, 'Comune obbligatorio'),
  zipCode: z.string().length(5, 'CAP deve essere 5 cifre'),
  province: z.string().length(2, 'Provincia (sigla, 2 caratteri)'),
  country: z.string().min(1).default('IT'),
  taxRegime: z.enum(['FORFETTARIO', 'ORDINARIO']),
  senderType: z.enum(['LIBERO_PROFESSIONISTA', 'DITTA_INDIVIDUALE', 'SOCIETA']),
});

type UserFormData = z.infer<typeof userSchema>;

type ConfirmAction = { kind: 'delete'; userId: string };

export function UserManagement({ onRefresh }: UserManagementProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema) as any,
    defaultValues: {
      email: '',
      name: '',
      businessName: '',
      vatNumber: '',
      taxCode: '',
      address: '',
      city: '',
      zipCode: '',
      province: '',
      country: 'IT',
      taxRegime: 'FORFETTARIO',
      senderType: 'LIBERO_PROFESSIONISTA',
    },
  });

  const doSave = async (data: UserFormData) => {
    const isEditing = !!editingUser;
    const url = isEditing ? `/api/users/${editingUser.id}` : '/api/users';
    const method = isEditing ? 'PUT' : 'POST';

    const submitData: Record<string, unknown> = { ...data };

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitData),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Errore salvataggio');
    }

    onRefresh();
    fetchUsers();
    form.reset({
      email: '',
      name: '',
      businessName: '',
      vatNumber: '',
      taxCode: '',
      address: '',
      city: '',
      zipCode: '',
      province: '',
      country: 'IT',
      taxRegime: 'FORFETTARIO',
      senderType: 'LIBERO_PROFESSIONISTA',
    });
    setEditingUser(null);
    setDialogOpen(false);
    toast.success(
      isEditing
        ? 'Modifiche salvate.'
        : 'Utente creato. Email di attivazione inviata.'
    );
  };

  const handleSubmit = async (data: UserFormData) => {
    try {
      await doSave(data);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Errore sconosciuto');
    }
  };

  // L'admin non imposta mai credenziali: invia solo email di reset all'utente.
  const sendResetEmail = async (kind: 'password' | 'mfa') => {
    if (!editingUser) return;
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: editingUser.email, kind }),
      });
      if (!res.ok) throw new Error('Errore invio email');
      alert(kind === 'mfa' ? 'Email per il reset 2FA inviata.' : 'Email per il reset password inviata.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Errore sconosciuto');
    }
  };

  const doDelete = async (userId: string, currentPassword: string) => {
    setDeletingUserId(userId);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Errore eliminazione');
      }
      onRefresh();
      fetchUsers();
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleDelete = (userId: string) => {
    setConfirmError(null);
    setConfirmAction({ kind: 'delete', userId });
  };

  const handleConfirmPassword = async (password: string) => {
    if (!confirmAction || confirmAction.kind !== 'delete') return;
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      await doDelete(confirmAction.userId, password);
      setConfirmAction(null);
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : 'Errore sconosciuto');
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleEdit = (user: User) => {
    form.reset({
      email: user.email,
      name: user.name,
      businessName: user.businessName,
      vatNumber: user.vatNumber,
      taxCode: user.taxCode,
      address: user.address,
      city: user.city,
      zipCode: user.zipCode,
      province: user.province,
      country: user.country,
      taxRegime: user.taxRegime,
      senderType: user.senderType,
    });
    setEditingUser(user);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-semibold">Gestione Utenti</h2>
          <p className="text-sm text-muted-foreground">
            Solo gli amministratori possono gestire gli utenti. Il primo utente creato è automaticamente amministratore.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="w-4 h-4 mr-2" />
              Nuovo Utente
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingUser ? 'Modifica Utente' : 'Nuovo Utente'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 mt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" {...form.register('email')} disabled={!!editingUser} />
                  {form.formState.errors.email && (
                    <p className="text-sm text-red-500">{form.formState.errors.email.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="name">Nome *</Label>
                  <Input id="name" {...form.register('name')} />
                  {form.formState.errors.name && (
                    <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="senderType">Tipologia Soggetto *</Label>
                  <Select value={form.watch('senderType')} onValueChange={(v) => form.setValue('senderType', v as SenderType)} required>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LIBERO_PROFESSIONISTA">Libero Professionista</SelectItem>
                      <SelectItem value="DITTA_INDIVIDUALE">Ditta Individuale</SelectItem>
                      <SelectItem value="SOCIETA">Società</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.formState.errors.senderType && (
                    <p className="text-sm text-red-500">{form.formState.errors.senderType.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="taxRegime">Regime Fiscale *</Label>
                  <Select value={form.watch('taxRegime')} onValueChange={(v) => form.setValue('taxRegime', v as 'FORFETTARIO' | 'ORDINARIO')} required>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FORFETTARIO">Forfettario</SelectItem>
                      <SelectItem value="ORDINARIO">Ordinario</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.formState.errors.taxRegime && (
                    <p className="text-sm text-red-500">{form.formState.errors.taxRegime.message}</p>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-lg font-semibold mb-4">Dati Fiscali</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="businessName">Denominazione / Ragione Sociale *</Label>
                    <Input id="businessName" {...form.register('businessName')} />
                    {form.formState.errors.businessName && (
                      <p className="text-sm text-red-500">{form.formState.errors.businessName.message}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="vatNumber">Partita IVA *</Label>
                    <Input id="vatNumber" {...form.register('vatNumber')} maxLength={11} />
                    {form.formState.errors.vatNumber && (
                      <p className="text-sm text-red-500">{form.formState.errors.vatNumber.message}</p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="taxCode">Codice Fiscale *</Label>
                    <Input id="taxCode" {...form.register('taxCode')} maxLength={16} />
                    {form.formState.errors.taxCode && (
                      <p className="text-sm text-red-500">{form.formState.errors.taxCode.message}</p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="address">Indirizzo *</Label>
                    <Input id="address" {...form.register('address')} />
                    {form.formState.errors.address && (
                      <p className="text-sm text-red-500">{form.formState.errors.address.message}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="city">Comune *</Label>
                    <Input id="city" {...form.register('city')} />
                    {form.formState.errors.city && (
                      <p className="text-sm text-red-500">{form.formState.errors.city.message}</p>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-4">
                  <div>
                    <Label htmlFor="zipCode">CAP *</Label>
                    <Input id="zipCode" {...form.register('zipCode')} maxLength={5} />
                    {form.formState.errors.zipCode && (
                      <p className="text-sm text-red-500">{form.formState.errors.zipCode.message}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="province">Provincia *</Label>
                    <Input id="province" {...form.register('province')} maxLength={2} />
                    {form.formState.errors.province && (
                      <p className="text-sm text-red-500">{form.formState.errors.province.message}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="country">Nazione</Label>
                    <Input id="country" {...form.register('country')} readOnly className="bg-muted" />
                  </div>
                </div>
              </div>

              {editingUser ? (
                <div className="border-t pt-4 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Password e 2FA si gestiscono solo via email (l&apos;admin non le conosce mai).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => sendResetEmail('password')}>
                      Invia email reset password
                    </Button>
                    <Button type="button" variant="outline" onClick={() => sendResetEmail('mfa')}>
                      Invia email reset 2FA
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    Alla creazione, l&apos;utente riceverà un&apos;email per impostare da sé la password.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => { setEditingUser(null); form.reset(); setDialogOpen(false); }}>
                  Annulla
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Salvataggio...
                    </>
                  ) : editingUser ? (
                    'Salva Modifiche'
                  ) : (
                    'Crea Utente'
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
              <p>Nessun utente trovato</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Ruolo</TableHead>
                  <TableHead>Regime</TableHead>
                  <TableHead>Denominazione</TableHead>
                  <TableHead>Clienti</TableHead>
                  <TableHead>Fatture</TableHead>
                  <TableHead>Creato il</TableHead>
                  <TableHead className="w-32">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map(user => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell className="font-mono text-sm">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === 'ADMIN' ? 'default' : 'secondary'} className="gap-1">
                        <Shield className="w-3 h-3" />
                        {USER_ROLE_LABELS[user.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{TAX_REGIME_LABELS[user.taxRegime]}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">{user.businessName}</TableCell>
                    <TableCell>{user._count.clients}</TableCell>
                    <TableCell>{user._count.invoices}</TableCell>
                    <TableCell className="text-sm">{new Date(user.createdAt).toLocaleDateString('it-IT')}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(user)}
                          title="Modifica"
                          disabled={deletingUserId === user.id}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(user.id)}
                          title="Elimina"
                          disabled={deletingUserId === user.id}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmPasswordDialog
        open={confirmAction !== null}
        title="Elimina utente"
        description="Verranno eliminati anche tutti i suoi dati (clienti, incassi, fatture). Inserisci la tua password per confermare."
        confirmLabel="Elimina"
        busy={confirmBusy}
        error={confirmError}
        onConfirm={handleConfirmPassword}
        onCancel={() => {
          setConfirmAction(null);
          setConfirmError(null);
        }}
      />
    </div>
  );
}