export type Role = "teacher" | "sub_admin" | "super_admin" | "organisation" | "student";
export type ApprovalStatus = "pending" | "active" | "rejected";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: ApprovalStatus;
  institution: string | null;
  staffId: string | null;
  syllabus: string | null;
}

export function isOnboarded(user: SessionUser | null): boolean {
  return Boolean(user?.institution && user?.syllabus);
}
