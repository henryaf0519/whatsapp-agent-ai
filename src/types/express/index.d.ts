declare namespace Express {
  // Aquí definimos la estructura del objeto 'user' que Passport adjuntará.
  // Es una buena práctica ser específico en lugar de usar 'any'.
  export interface User {
    userId: string;
    email: string;
    waba_id: string;
  }

  // Ahora extendemos la interfaz Request para incluir nuestra nueva definición de User.
  export interface Request {
    user?: User;
  }
}
