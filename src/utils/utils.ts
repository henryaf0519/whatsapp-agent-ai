export function normalizeString(str: string): string {
  const map: { [key: string]: string } = {
    á: 'a',
    é: 'e',
    í: 'i',
    ó: 'o',
    ú: 'u',
    Á: 'a',
    É: 'e',
    Í: 'i',
    Ó: 'o',
    Ú: 'u',
    à: 'a',
    è: 'e',
    ì: 'i',
    ò: 'o',
    ù: 'u',
    ä: 'a',
    ë: 'e',
    ï: 'i',
    ö: 'o',
    ü: 'u',
    â: 'a',
    ê: 'e',
    î: 'i',
    ô: 'o',
    û: 'u',
    ã: 'a',
    ñ: 'n',
    õ: 'o',
    ç: 'c',
    // Puedes agregar más caracteres especiales si es necesario
  };

  return str
    .split('') // Separa la cadena en un array de caracteres
    .map((char) => map[char] || char) // Reemplaza las letras acentuadas
    .join('') // Une los caracteres nuevamente
    .toUpperCase();
}
