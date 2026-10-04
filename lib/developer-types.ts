export type DeveloperProfile = {
  id: string;
  username: string;
  name: string;
  visibility: 'public' | 'private';
  created: number;
  projects: number;
  tracks: number;
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
  users: {
    items: DeveloperProfile[];
    page: number;
    pageSize: number;
    total: number;
  };
  health: { database: 'reachable'; queryMs: number };
};
