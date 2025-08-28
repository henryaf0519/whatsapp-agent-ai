import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import 'reflect-metadata';
import cookieParser from 'cookie-parser';
declare const module: any;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  /*  const whitelist = [
    'http://localhost:5173', // Tu entorno de desarrollo
    'https://orvexchat-666d6.web.app', // Tu entorno de producción
  ];

  app.enableCors({
    origin: function (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) {
      if (!origin || whitelist.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });*/
  app.set('trust proxy', 1);
  app.use(cookieParser());
  await app.listen(process.env.PORT ?? 3000);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (module.hot) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    module.hot.accept();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    module.hot.dispose(() => app.close());
  }
  console.log(`Application is running on: ${await app.getUrl()}`);
}
void bootstrap();
