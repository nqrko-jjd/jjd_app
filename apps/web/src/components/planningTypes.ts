export interface PlanPerson { id: string; displayName: string | null; firstName: string; phone?: string | null }
export interface PlanVehicleRef {
  id: string; plate: string | null; model: string | null; brand: string | null; code: string | null; seats: number | null;
}

export interface PlanningEv {
  id: string;
  title: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  status: string;
  worksite: { id: string; ref: string; title: string; city: string | null; address?: string | null };
  team: { id: string; name: string; color: string | null } | null;
  vehicles: { vehicle: PlanVehicleRef; driver: PlanPerson | null }[];
  assignments: { person: PlanPerson }[];
  equipment: { equipment: { id: string; name: string } }[];
  consumables: { qty: number; consumable: { id: string; name: string; unit: string } }[];
  leadPerson: PlanPerson | null;
  driverPerson: PlanPerson | null;
  departureAt: string | null;
  departureFrom: string | null;
  tasksNote: string | null;
  accessNote: string | null;
  materialsNote: string | null;
  note: string | null;
}

export interface PlanAbsence {
  id: string;
  personId: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  note: string | null;
  person: { id: string; displayName: string | null; firstName: string };
}
