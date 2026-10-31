const vinextHandler = {
  fetch(request: Request) {
    if (new URL(request.url).pathname.endsWith('/throw')) {
      throw new Error('render failure');
    }
    return Promise.resolve(new Response('rendered'));
  },
};

export default vinextHandler;
