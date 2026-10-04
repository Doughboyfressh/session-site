export type DeveloperProfile = {
  id: string;
  username: string;
  name: string;
  visibility: 'public' | 'private';
  created: number;
  projects: number;
  tracks: number;
};

export type DeveloperActivity = {
  status: 'ready' | 'not-configured' | 'unavailable';
  timezone: 'UTC';
  collectedSince: string | null;
  visitorsToday: number | null;
  dailyActiveUsersToday: number | null;
  days: { day: string; visitors: number | null; activeUsers: number | null }[];
};

export type DeveloperDashboard = {
  generatedAt: number;
  metrics: {
    profiles: number;
    profiles7d: number;
    publicProfiles: number;
    projects: number;
    publicTracks: number;
    privateTracks: number;
    posts: number;
    rooms: number;
    liveRooms: number;
    liveParticipants: number;
    files: number;
    mediaBytes: number;
    reports: number;
    recordedActiveCreators7d: number;
  };
  signupDays: { day: string; count: number }[];
  activity: DeveloperActivity;
  users: {
    items: DeveloperProfile[];
    page: number;
    pageSize: number;
    total: number;
  };
  health: { database: 'reachable'; queryMs: number };
};
