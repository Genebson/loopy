export interface GitHubCard {
  id: string;
  contentId: string;
  title: string;
  body: string;
  columnId: string;
  assignees: string[];
  labels: string[];
  url: string;
  issueNumber: number;
}