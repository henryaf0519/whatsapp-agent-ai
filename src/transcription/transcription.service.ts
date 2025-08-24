import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads'; // <-- ¡Importa la función de ayuda!

@Injectable()
export class TranscriptionService {
  private readonly openai: OpenAI;
  private readonly logger = new Logger(TranscriptionService.name);

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY no está configurada');
    }
    this.openai = new OpenAI({ apiKey });
  }

  // ✅ MÉTODO CORREGIDO
  async transcribeAudio(
    audioBuffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    this.logger.log('Iniciando transcripción de audio...');

    try {
      // Extraer la extensión del mimeType, por ej. 'ogg' de 'audio/ogg; codecs=opus'
      const extension = mimeType.split('/')[1]?.split(';')[0] || 'ogg';
      const fileName = `audio.${extension}`;

      // Usar el helper 'toFile' para convertir el buffer en un objeto 'Uploadable' que la API entiende
      const file = await toFile(audioBuffer, fileName, { type: mimeType });

      const transcription = await this.openai.audio.transcriptions.create({
        file: file, // Ahora 'file' tiene el formato correcto
        model: 'whisper-1',
      });

      this.logger.log('Transcripción completada exitosamente.');
      return transcription.text;
    } catch (error) {
      this.logger.error('Error durante la transcripción', error);
      // Re-lanzamos el error original para mantener los detalles
      throw error;
    }
  }
}
