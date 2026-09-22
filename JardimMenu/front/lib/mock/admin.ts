import type { DeviceRow, StoreUserRow, TableRow } from "../types";

/** Dados de exemplo do painel de configuração, na etapa A1. */

const STORE_ID = "11111111-1111-4111-8111-111111111111";
/** Ids de exemplo em UUID válido: doze dígitos hexadecimais no último grupo. */
const id = (p: string, n: number) => `11111111-1111-4111-8111-${p}${String(n).padStart(8, "0")}`;

const agora = Date.now();
const minutosAtras = (m: number) => new Date(agora - m * 60_000).toISOString();

export const mockTables: TableRow[] = Array.from({ length: 10 }, (_, i) => {
  const numero = i + 1;
  const desligada = numero === 4 || numero === 9;
  return {
    id: id("3333", numero),
    store_id: STORE_ID,
    number: numero,
    label: numero <= 6 ? `Jardim ${numero}` : `Varanda ${numero - 6}`,
    ordering_enabled: !desligada,
    ordering_disabled_reason: desligada
      ? numero === 4
        ? "Tablet com a tela trincada"
        : "Mesa reservada para evento"
      : null,
    is_active: true,
  };
});

export const mockDevices: DeviceRow[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    id: id("4444", i + 1),
    store_id: STORE_ID,
    table_id: id("3333", i + 1),
    table_number: i + 1,
    name: `Tablet Mesa ${i + 1}`,
    status: "active" as const,
    app_version: "1.0.0",
    battery_level: [82, 64, 91, 14, 77, 55, 38, 96][i],
    last_seen_at: minutosAtras([1, 2, 1, 3, 1, 12, 2, 1][i]),
  })),
  {
    id: id("4444", 9),
    store_id: STORE_ID,
    table_id: id("3333", 9),
    table_number: 9,
    name: "Tablet Mesa 9",
    status: "inactive",
    app_version: "1.0.0",
    battery_level: null,
    last_seen_at: minutosAtras(240),
  },
  {
    id: id("4444", 10),
    store_id: STORE_ID,
    table_id: null,
    table_number: null,
    name: "Tablet reserva",
    status: "retired",
    app_version: "0.9.4",
    battery_level: null,
    last_seen_at: null,
  },
];

export const mockUsers: StoreUserRow[] = [
  { id: id("5555", 1), user_id: id("6666", 1), store_id: STORE_ID, email: "dono@jardimsecreto.com.br", role: "owner", is_active: true },
  { id: id("5555", 2), user_id: id("6666", 2), store_id: STORE_ID, email: "gestor@jardimsecreto.com.br", role: "manager", is_active: true },
  { id: id("5555", 3), user_id: id("6666", 3), store_id: STORE_ID, email: "salao@jardimsecreto.com.br", role: "waiter", is_active: true },
  { id: id("5555", 4), user_id: id("6666", 4), store_id: STORE_ID, email: "cozinha@jardimsecreto.com.br", role: "kitchen", is_active: false },
];
