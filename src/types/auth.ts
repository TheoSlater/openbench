export type User = {
  id: string;
  email: string;
  fullName?: string;
  status: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
};

export type AuthResponse = {
  user: User;
  token: string;
};
