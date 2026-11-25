import { reddit } from '@devvit/web/server';

export const createPost = async () =>
  await reddit.submitCustomPost({
    title: 'Orbital Chess — one daily game, a whole tree of moves',
  });
