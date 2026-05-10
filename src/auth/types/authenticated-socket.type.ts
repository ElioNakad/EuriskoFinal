import { Socket } from 'socket.io';

export type AuthenticatedSocket = Socket & {
  user?: {
    userId: string;
    email: string;
  };
};
