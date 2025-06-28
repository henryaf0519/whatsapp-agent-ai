/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { MessagesAnnotation, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ConfigService } from '@nestjs/config';
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
@Injectable()
export class PruebaService implements OnModuleInit {
  private llmWithTools!: ReturnType<ChatOpenAI['bindTools']>;
  private tools!: any[];
  private agentBuilder: any = null;
  private userHistories: Record<string, Message[]> = {};

  constructor(private config: ConfigService) {
    if (!this.config.get<string>('OPENAI_API_KEY')) {
      throw new Error('OPENAI_API_KEY no configurada');
    }
  }

  onModuleInit() {
    console.log('Inicializando PruebaService...');
    // Instancia el modelo LLM
    const llm = new ChatOpenAI({
      openAIApiKey: this.config.get<string>('OPENAI_API_KEY'),
      modelName: 'gpt-4o', // o el modelo que prefieras
    });

    const listPsychologists = tool(
      () => {
        console.log('Listing available psychologists...');
        return `1. Dra. Sofía Torres - Especialidad: Ansiedad - Precio: $100.000
2. Dr. Juan Pérez - Especialidad: Depresión - Precio: $120.000
Por favor, dime con cuál psicólogo te gustaría agendar la cita.`;
      },
      {
        name: 'listPsychologists',
        description: 'Muestra psicólogos disponibles para agendar cita.',
        schema: z.object({}),
      },
    );

    const getAvailableSlots = tool(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ psychologist, date }) => {
        console.log(
          `Obteniendo horarios disponibles para ${psychologist} en ${date}...`,
        );
        // Simula horarios disponibles (en real, consulta Google Calendar)
        return `
          '09:00 AM - 10:00 AM',
          '11:00 AM - 12:00 PM',
          '02:00 PM - 03:00 PM',
        `;
      },
      {
        name: 'getAvailableSlots',
        description:
          'Devuelve horarios libres de un psicólogo en una fecha específica.',
        schema: z.object({
          psychologist: z.string().describe('Nombre del psicólogo'),
          date: z.string().describe('Fecha solicitada (YYYY-MM-DD)'),
        }),
      },
    );

    const createAppointment = tool(
      ({ psychologist, date, hour, clientName }) => {
        console.log(
          `Agendando cita con ${psychologist} el ${date} a las ${hour} para ${clientName}...`,
        );
        return `✅ Cita agendada con ${psychologist} el ${date} a las ${hour} a nombre de ${clientName}`;
      },
      {
        name: 'createAppointment',
        description:
          'Agenda una cita en Google Calendar con el psicólogo elegido.',
        schema: z.object({
          psychologist: z.string(),
          date: z.string(),
          hour: z.string(),
          clientName: z.string(),
        }),
      },
    );

    this.tools = [listPsychologists, getAvailableSlots, createAppointment];
    this.llmWithTools = llm.bindTools(this.tools);

    // Función de llamada al LLM
    const llmCall = async (state: typeof MessagesAnnotation.State) => {
      const result = await this.llmWithTools.invoke([
        {
          role: 'system',
          content: `Eres un asistente conversacional para la app Appodium. Tu tarea es ayudar al usuario a agendar una cita con uno de los psicólogos disponibles, siempre guiando la conversación paso a paso. 

        **Reglas:**
        - Saluda y da la bienvenida.
        - Pregunta si desea agendar una cita.
        - Si responde que sí, muestra la lista de psicólogos disponibles.
        - Espera a que el usuario elija un psicólogo.
        - Pide la fecha para la cita.
        - Cuando la tengas, consulta los horarios disponibles para ese psicólogo y fecha.
        - Espera a que el usuario elija la hora.
        - Cuando la hora esté definida, crea la cita.
        - Confirma la cita y despídete.

        **Muy importante:**
        - Nunca asumas datos que el usuario no te haya dado.
        - Haz preguntas cortas y claras.
        - Si el usuario da información antes de que la pidas (ej: dice psicólogo y fecha en el mismo mensaje), procesa todo lo posible, pero igual confirma los pasos.
        - Si el usuario da una respuesta ambigua, pídele aclarar.
        - No muestres toda la información ni preguntes varias cosas a la vez.
        - Sé amable y profesional.`,
        },
        ...state.messages,
      ]);
      return { messages: [result] };
    };
    const toolNode = new ToolNode(this.tools);

    // Función condicional para decidir el flujo
    function shouldContinue(state) {
      const messages = state.messages;
      const lastMessage = messages.at(-1);
      if (lastMessage?.tool_calls?.length) {
        return 'Action';
      }
      return '__end__';
    }

    // Construye el grafo del agente
    this.agentBuilder = new StateGraph(MessagesAnnotation)
      .addNode('llmCall', llmCall)
      .addNode('tools', toolNode)
      .addEdge('__start__', 'llmCall')
      .addConditionalEdges('llmCall', shouldContinue, {
        Action: 'tools',
        __end__: '__end__',
      })
      .addEdge('tools', 'llmCall')
      .compile();
  }

  // Método público para usar el agente
  async calcular(mensaje: string) {
    const messages = [
      {
        role: 'user',
        content: mensaje,
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = await this.agentBuilder.invoke({ messages });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return result.messages.at(-1)?.content || 'No response from agent';
  }

  async conversar(userId: string, mensaje: string) {
    // Inicializa el historial del usuario si no existe
    if (!this.userHistories[userId]) {
      this.userHistories[userId] = [];
    }

    // Agrega el mensaje del usuario al historial
    this.userHistories[userId].push({
      role: 'user',
      content: mensaje,
    });

    // Opcional: limita el historial a los últimos N mensajes para ahorrar tokens
    const MAX_HISTORY = 12;
    const messagesToSend = this.userHistories[userId].slice(-MAX_HISTORY);

    // Ejecuta el agente con todo el historial relevante
    const result = await this.agentBuilder.invoke({ messages: messagesToSend });

    // Agrega la respuesta de la IA al historial
    if (result.messages.at(-1)?.content) {
      this.userHistories[userId].push({
        role: 'assistant',
        content: result.messages.at(-1).content,
      });
    }

    // Devuelve la última respuesta de la IA
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return result.messages.at(-1)?.content || 'No response from agent';
  }
}
