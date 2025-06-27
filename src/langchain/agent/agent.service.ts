// src/agent/agent.service.ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { createToolCallingAgent, AgentExecutor } from 'langchain/agents';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts'; // Importa MessagesPlaceholder
import {
  HumanMessage,
  AIMessage, // Importa ToolMessage
} from '@langchain/core/messages'; // Importa los tipos de mensajes de LangChain
import {
  CalendarGetTool,
  CalendarSetTool,
  CalendarUpdateTool,
  GmailSendTool,
} from '../tools';
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'; // Agregamos 'tool' para las respuestas de herramientas
  content: string;
}
import moment from 'moment-timezone';

@Injectable()
export class AgentService implements OnModuleInit {
  private executor!: AgentExecutor;
  private readonly logger = new Logger(AgentService.name);
  // Almacenamiento simple en memoria para el historial de chat.
  // En producción, esto debería ser persistente (ej. Redis, DB) y por usuario/conversación.
  private chatHistories = new Map<string, ChatMessage[]>(); // Key: conversationId, Value: ChatMessage[]

  constructor(private config: ConfigService) {
    if (!this.config.get<string>('OPENAI_API_KEY')) {
      throw new Error('OPENAI_API_KEY no configurada');
    }
  }

  onModuleInit() {
    this.logger.log('Initializing AgentService...');

    const currentDate = moment.tz('America/Bogota').format('YYYY-MM-DD');

    const llm = new ChatOpenAI({
      openAIApiKey: this.config.get<string>('OPENAI_API_KEY')!,
      modelName: 'gpt-4o',
      temperature: 0,
    });

    const tools = [
      new CalendarGetTool(),
      new CalendarSetTool(),
      new CalendarUpdateTool(),
      new GmailSendTool(),
    ];

    // Modifica el prompt para incluir el historial de chat
    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        `Eres un asistente experto en gestión de citas para Appodium. Tu objetivo principal es ayudar al usuario a agendar o consultar citas en su calendario.

    ---
    **Fechas y Horas:**
    * Siempre que el usuario use expresiones como "mañana", "pasado mañana", "el próximo [día de la semana]", "en 3 días", etc., **deduce la fecha exacta en formato YYYY-MM-DD**.
    * La fecha actual es **${currentDate}**. Utiliza esta referencia para inferir fechas futuras o del día actual.
    * Si el usuario menciona una fecha del pasado (por ejemplo, "el 1 de enero" cuando el año actual es 2025), asume que se refiere al **mismo día del próximo año** (ej. "1 de enero de 2026").
    * Si no estás seguro de la fecha o es ambigua, pídele una aclaración al usuario.
    * **Importante:** Nunca preguntes al usuario sobre el título de la cita. Siempre usa el título fijo "Cita Appodium" para todas las citas que agendes.

    ---
    **Flujo de Interacción para Agendar Citas:**
    Sigue estrictamente estos pasos:

    1.  **Obtener Fecha:** Si el usuario desea agendar una cita y aún no ha especificado la fecha, SIEMPRE pregunta: "¿Para qué fecha deseas agendar tu cita?" o una pregunta similar para obtener el día exacto.
    2.  **Consultar Disponibilidad (Paso Obligatorio):** UNA VEZ QUE TENGAS LA FECHA (ya sea que el usuario la proporcionó explícitamente o tú la dedujiste), DEBES USAR LA HERRAMIENTA **Calendar_Get** PARA MOSTRAR LOS HORARIOS DISPONIBLES para ese día. Presenta los huecos de forma clara, por ejemplo: "Para el [fecha], tengo disponibles los siguientes horarios: [hora1 - hora2], [hora2-hora3], [hora3 - hora4]". No pases al siguiente paso hasta que hayas mostrado la disponibilidad.
    3.  **Confirmar Elección:** Espera a que el usuario elija uno de los horarios disponibles que le has mostrado.
    4.  **Agendar Cita:** Una vez que el usuario confirma la fecha, la hora y el título ("Cita Appodium"), usa la herramienta **Calendar_Set** para agendar la cita.

    ---
    **Directrices Generales:**
    * Sé conciso y eficiente en tus respuestas.
    * Usa las herramientas de forma apropiada y siempre que puedas resolver una petición con ellas.
    * Si te falta información para usar una herramienta, pídesela al usuario de forma clara y específica.
    * Si no puedes realizar una acción, explica por qué y qué información adicional necesitas.
    `,
      ],
      new MessagesPlaceholder('chat_history'),
      ['human', '{input}'],
      ['placeholder', '{agent_scratchpad}'],
    ]);

    const agent = createToolCallingAgent({
      llm,
      tools,
      prompt,
    });

    this.executor = new AgentExecutor({
      agent,
      tools,
      verbose: false,
    });

    this.logger.log('AgentService initialized successfully.');
  }

  // Modifica handleMessage para aceptar un conversationId
  async handleMessage(
    userInput: string,
    conversationId: string = 'default',
  ): Promise<string> {
    try {
      this.logger.log(
        `Invoking agent for conversationId: ${conversationId} with input: "${userInput}"`,
      );

      // Recupera el historial de chat para esta conversación
      const currentChatHistory = this.chatHistories.get(conversationId) || [];

      // Convierte el historial a los tipos de mensajes de LangChain
      const langChainChatHistory = currentChatHistory.map((msg) => {
        if (msg.role === 'user') {
          return new HumanMessage(msg.content);
        } else if (msg.role === 'assistant') {
          return new AIMessage(msg.content);
        } else if (msg.role === 'tool') {
          // Si tu herramienta devuelve un ToolMessage, asegúrate de tener el tool_call_id
          // Por ahora, lo tratamos como un AIMessage si el contenido es solo texto.
          // Si tus herramientas de LangChain devuelven ToolCalls, necesitarías un manejo más sofisticado aquí.
          return new AIMessage(msg.content);
        }
        return new HumanMessage(msg.content); // Fallback
      });

      const result = await this.executor.invoke({
        input: userInput,
        chat_history: langChainChatHistory, // Pasa el historial aquí
      });


      const output = result.output;
      const responseText = typeof output === 'string' ? output : String(output);

      // Actualiza el historial de chat con el nuevo turno
      currentChatHistory.push({ role: 'user', content: userInput });
      currentChatHistory.push({ role: 'assistant', content: responseText });
      this.chatHistories.set(conversationId, currentChatHistory);

      return responseText;
    } catch (error) {
      this.logger.error('Error during agent execution:', error);
      return 'Lo siento, ha ocurrido un error al procesar tu solicitud.';
    }
  }
}
