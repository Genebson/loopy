export type ColumnRole = 'ready' | 'inProgress' | 'inReview' | 'done' | 'blocked';

export interface Column {
  id: string;
  name: string;
  role: ColumnRole;
}