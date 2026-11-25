import { reddit } from '@devvit/web/server';

export const createPost = async () =>
  await reddit.submitCustomPost({
    title: 'Orbital Chess — one move, then pass the board',
  });
